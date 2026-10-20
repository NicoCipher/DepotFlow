-- M2d-1 verification on a disposable PG16 database only.
-- All fixtures, payments, sales, and ownership changes roll back.
begin;
-- Rollback-only legacy ID fixture: customers are now created through a
-- generated-ID legacy RPC, NOT direct authenticated INSERT(id). Preserve
-- historical trigger/RLS constraints under a temporary test-only grant.
grant insert(id) on public.customers to authenticated;

insert into auth.users(id) values
 ('88000000-0000-4000-8000-000000000001'),
 ('88000000-0000-4000-8000-000000000002');
insert into private.shop_owner(user_id)
values ('88000000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();

insert into public.product_catalogue(id,name)
values ('88000000-0000-4000-9000-000000000090','M2d Global Photo');

insert into public.shop_profile(id,name,address,phone)
values (true,'M2d Legacy Shop','Lagos','08012345678');
insert into public.crate_types(id,name,empty_family,pocket_count)
values ('88000000-0000-4000-9000-000000000010','M2d empty crate','M2d',12);
insert into public.products(
 id,name,bottles_per_crate,full_crate_price,bottle_price,
 bottles_returnable,crate_type_id
) values (
 '88000000-0000-4000-9000-000000000020','M2d Drink',12,
 12000,1000,false,'88000000-0000-4000-9000-000000000010'
);
insert into public.stock(product_id,total_bottles)
values ('88000000-0000-4000-9000-000000000020',120);
insert into public.customers(id,name,phone)
values ('88000000-0000-4000-9000-000000000030','M2d customer','08000008001');
insert into public.money_owed(customer_id,amount)
values ('88000000-0000-4000-9000-000000000030',3000);

-- Prove historical NULL rows independently block activation: validate
-- 30 of the 31 M2c shadow FKs first (MATCH SIMPLE allows legacy NULL tags).
-- Leave the sale/customer FK unvalidated to separately test the FK gate.
do $validate_early$
declare r record; v_count integer:=0;
begin
  for r in
    select ns.nspname s, cls.relname t, c.conname k
    from pg_constraint c
    join pg_class cls on cls.oid=c.conrelid
    join pg_namespace ns on ns.oid=cls.relnamespace
    join private.legacy_scope_tables() scope
      on scope.schema_name=ns.nspname and scope.table_name=cls.relname
    join pg_constraint original
      on original.conrelid=c.conrelid and original.confrelid=c.confrelid
     and original.contype='f' and c.conname='tenant_'||original.conname
     and array_length(original.conkey,1)=1
     and array_length(original.confkey,1)=1
    join pg_attribute child_scope
      on child_scope.attrelid=c.conrelid
     and child_scope.attname='business_id'
     and not child_scope.attisdropped
    join pg_attribute parent_scope
      on parent_scope.attrelid=c.confrelid
     and parent_scope.attname='business_id'
     and not parent_scope.attisdropped
    where c.contype='f'
      and c.conkey=ARRAY[child_scope.attnum,original.conkey[1]]::smallint[]
      and c.confkey=ARRAY[parent_scope.attnum,original.confkey[1]]::smallint[]
      and left(c.conname,7)='tenant_'
      and c.confrelid in (
        'public.customers'::regclass,
        'public.crate_types'::regclass,
        'public.products'::regclass,
        'public.sales'::regclass,
        'public.sale_empty_decisions'::regclass
      )
      and c.conname<>'tenant_sales_customer_id_fkey'
  loop
    execute pg_catalog.format(
      'alter table %I.%I validate constraint %I',r.s,r.t,r.k
    );
    v_count:=v_count+1;
  end loop;
  if v_count<>30 then
    raise exception 'Expected exactly 30 initially validated FKs, found %',v_count;
  end if;
end;
$validate_early$;

do $preflight$
declare v_snapshot jsonb; v_err text;
begin
  if (select count(*) from pg_trigger
      where tgname='legacy_scope_business_write' and not tgisinternal)<>29 then
    raise exception 'M2d did not install all 29 operational write triggers';
  end if;
  if (select count(*) from pg_trigger
      where tgname='legacy_scope_business_write'
        and (tgtype & 8)=8 and not tgisinternal)<>29 then
    raise exception 'M2d missing active-membership DELETE guards';
  end if;
  if not exists(
    select 1 from pg_trigger
    where tgname='legacy_scope_catalogue_image_write'
      and tgrelid='public.product_catalogue'::regclass
      and (tgtype & 16)=16 and not tgisinternal
  ) then
    raise exception 'M2d missing catalogue image edit guard';
  end if;
  if (select count(*) from private.legacy_write_scope_gate)<>0 then
    raise exception 'M2d enabled stamping automatically';
  end if;
  if (select count(*) from public.customers where business_id is null)<>1 then
    raise exception 'M2d prematurely changed existing customer identity';
  end if;
  v_snapshot:=private.legacy_scope_snapshot();
  begin
    perform private.enable_legacy_write_scope(v_snapshot);
    raise exception 'Unbackfilled legacy rows were activated' using errcode='PT001';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_err=message_text;
    if v_err not like 'All historical rows%' then
      raise exception 'Unexpected enable failure: %',v_err;
    end if;
  end;
end;
$preflight$;

-- Explicit backfill, exactly as the reviewed M2b admin workflow requires.
select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());

-- A validated FK in an unrelated table must not substitute for an
-- unvalidated real M2c FK. The earlier name-only count would mistakenly
-- see 31 validated constraints and allow activation.
create table private.tenant_fk_decoy (
  business_id uuid,
  constraint tenant_unrelated_valid_fk
    foreign key (business_id) references private.businesses(id)
);
do $decoy$
begin
  if (select count(*) from pg_constraint
      where left(conname,7)='tenant_' and convalidated)<>31 then
    raise exception 'Decoy did not reproduce the vulnerable FK count';
  end if;
end;
$decoy$;

-- Even after backfill, activating with one unvalidated M2c FK must fail.
-- This independently proves the exact-FK gate, not just row reconciliation.
do $incomplete_fk$
declare v_error text;
begin
  begin
    perform private.enable_legacy_write_scope(private.legacy_scope_snapshot());
    raise exception 'Unvalidated tenant FK was accepted' using errcode='PT001';
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error=message_text;
    if v_error not like 'Exactly 31 matching M2c tenant FKs%' then
      raise exception 'Unexpected unvalidated-FK failure: %',v_error;
    end if;
  end;
end;
$incomplete_fk$;

-- Last business FK is validated separately in this disposable transaction.
-- Production must validate ALL 31 after the audited backfill.
alter table public.sales validate constraint tenant_sales_customer_id_fkey;

do $all_valid$
begin
 if (select count(*) from pg_constraint c
      join pg_class cls on cls.oid=c.conrelid
      join pg_namespace ns on ns.oid=cls.relnamespace
      join private.legacy_scope_tables() sc
        on sc.schema_name=ns.nspname and sc.table_name=cls.relname
      join pg_constraint original
        on original.conrelid=c.conrelid and original.confrelid=c.confrelid
       and original.contype='f' and c.conname='tenant_'||original.conname
       and array_length(original.conkey,1)=1
       and array_length(original.confkey,1)=1
      join pg_attribute child_scope
        on child_scope.attrelid=c.conrelid
       and child_scope.attname='business_id'
       and not child_scope.attisdropped
      join pg_attribute parent_scope
        on parent_scope.attrelid=c.confrelid
       and parent_scope.attname='business_id'
       and not parent_scope.attisdropped
      where c.contype='f' and left(c.conname,7)='tenant_'
        and c.conkey=ARRAY[child_scope.attnum,original.conkey[1]]::smallint[]
        and c.confkey=ARRAY[parent_scope.attnum,original.confkey[1]]::smallint[]
        and c.confrelid in (
          'public.customers'::regclass,
          'public.crate_types'::regclass,
          'public.products'::regclass,
          'public.sales'::regclass,
          'public.sale_empty_decisions'::regclass
        )
        and c.convalidated)<>31 then
   raise exception 'Failed to validate all 31 M2c tenant relationships';
 end if;
end;
$all_valid$;

select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

do $gate$
declare v_business uuid;
begin
 select id into strict v_business from private.businesses
 where legacy_singleton is true;
 if not exists(
   select 1 from private.legacy_write_scope_gate
   where business_id=v_business and enabled is true
 ) then raise exception 'Backfilled scope was not enabled'; end if;

 -- A second administrative activation against the same approved inventory
 -- is safe; it cannot create another gate or alter the target identity.
 if private.enable_legacy_write_scope(private.legacy_scope_snapshot())
    is distinct from v_business then
   raise exception 'Idempotent enable changed business identity';
 end if;
 if has_table_privilege('authenticated',
     'private.legacy_write_scope_gate','SELECT')
   or has_table_privilege('anon',
     'private.legacy_write_scope_gate','SELECT')
   or has_function_privilege('authenticated',
     'private.enable_legacy_write_scope(jsonb)','EXECUTE')
   or has_function_privilege('anon',
     'private.enable_legacy_write_scope(jsonb)','EXECUTE')
   or has_function_privilege('service_role',
     'private.enable_legacy_write_scope(jsonb)','EXECUTE') then
   raise exception 'Client was granted an administrative scope capability';
 end if;
end;
$gate$;

-- Owner is authenticated and can perform ordinary shop writes without
-- specifying any business_id; it comes from verified database membership.
select set_config('request.jwt.claim.sub',
 '88000000-0000-4000-8000-000000000001',true);
set local role authenticated;
insert into public.customers(id,name,phone)
values ('88000000-0000-4000-9000-000000000031',
        'M2d second customer','08000008002');

select public.record_payment(
 '88000000-0000-4000-8000-000000000040',
 '88000000-0000-4000-9000-000000000030',
 1000,'2026-10-15','cash'
);
-- Idempotent payment retries remain idempotent after business tagging.
select public.record_payment(
 '88000000-0000-4000-8000-000000000040',
 '88000000-0000-4000-9000-000000000030',
 1000,'2026-10-15','cash'
);

-- The existing atomic sale API must stamp all its inserts/updates without
-- a client-supplied business_id. One bottle = 1000, paid 500, owing 500.
do $sale$
declare
  v_line jsonb;
  v_sale jsonb;
begin
  v_line:=pg_catalog.jsonb_build_object(
    'productId','88000000-0000-4000-9000-000000000020',
    'quantity',pg_catalog.jsonb_build_object(
      'crates',0,'fraction',0,'eighths',0,'bottles',1),
    'cratesTaken',0,'returnedCrates',0,'returnedBottles',0,
    'emptyDecisions','[]'::jsonb,
    'expected',pg_catalog.jsonb_build_object(
      'full',12000,'half',null,'quarter',null,'bottle',1000,
      'size',12,'crate','88000000-0000-4000-9000-000000000010',
      'returnable',false,'bottleType',null)
  );
  v_sale:=public.save_sale_v2(
    '88000000-0000-4000-8000-000000000050',
    '88000000-0000-4000-9000-000000000030',
    '2026-10-15',500,
    pg_catalog.jsonb_build_array(v_line),'[]'::jsonb,'[]'::jsonb,'cash'
  );
  if (v_sale->>'total')::int<>1000
     or (v_sale->>'paid')::int<>500 then
    raise exception 'M2d changed the existing sale money calculation: %',v_sale;
  end if;
  perform public.save_sale_v2(
    '88000000-0000-4000-8000-000000000050',
    '88000000-0000-4000-9000-000000000030',
    '2026-10-15',500,
    pg_catalog.jsonb_build_array(v_line),'[]'::jsonb,'[]'::jsonb,'cash'
  );
end;
$sale$;

-- Combined checkout must also keep the earlier debt-payment ledger separate
-- from the current sale. This is a different security-definer RPC path.
do $combined$
declare
  v_line jsonb;
  v_result jsonb;
begin
  v_line:=pg_catalog.jsonb_build_object(
    'productId','88000000-0000-4000-9000-000000000020',
    'quantity',pg_catalog.jsonb_build_object(
      'crates',0,'fraction',0,'eighths',0,'bottles',1),
    'cratesTaken',0,'returnedCrates',0,'returnedBottles',0,
    'emptyDecisions','[]'::jsonb,
    'expected',pg_catalog.jsonb_build_object(
      'full',12000,'half',null,'quarter',null,'bottle',1000,
      'size',12,'crate','88000000-0000-4000-9000-000000000010',
      'returnable',false,'bottleType',null)
  );
  v_result:=public.save_sale_with_old_debt_payment(
    '88000000-0000-4000-8000-000000000051',
    '88000000-0000-4000-9000-000000000030',
    '2026-10-15',1000,
    pg_catalog.jsonb_build_array(v_line),'[]'::jsonb,'[]'::jsonb,
    'cash',500
  );
  if (v_result->>'total')::int<>1000
     or (v_result->>'oldDebtPaid')::int<>500
     or (v_result->>'balanceAfter')::int<>2000 then
    raise exception 'M2d broke combined checkout debt accounting: %',v_result;
  end if;
  perform public.save_sale_with_old_debt_payment(
    '88000000-0000-4000-8000-000000000051',
    '88000000-0000-4000-9000-000000000030',
    '2026-10-15',1000,
    pg_catalog.jsonb_build_array(v_line),'[]'::jsonb,'[]'::jsonb,
    'cash',500
  );
end;
$combined$;

-- The authorized owner may still create and remove genuinely unused
-- empty crate types, and update the shared catalogue photo path.
select public.create_crate_type(
 '88000000-0000-4000-8000-000000000080',
 'M2d legitimate deletion','M2d',12,'test'
);
select public.delete_unused_crate_type(
 '88000000-0000-4000-8000-000000000080'
);
select public.create_crate_type(
 '88000000-0000-4000-8000-000000000081',
 'M2d revoke deletion','M2d',12,'test'
);
update public.product_catalogue
set image_path='catalogue/88000000-0000-4000-9000-000000000090/88000000-0000-4000-8000-000000000091.webp'
where id='88000000-0000-4000-9000-000000000090';

-- Other existing APIs also write through the same protected tables.
-- A counted stock adjustment, empty-crate count and exact-type receiving
-- must atomically tag both snapshot rows and immutable movement receipts.
select public.set_current_stock(
 '88000000-0000-4000-8000-000000000052',
 '88000000-0000-4000-9000-000000000020',
 5,0,'2026-10-15',118,12
);
select public.set_current_stock(
 '88000000-0000-4000-8000-000000000052',
 '88000000-0000-4000-9000-000000000020',
 5,0,'2026-10-15',118,12
);
select public.set_empty_crate_count(
 '88000000-0000-4000-8000-000000000053',
 '88000000-0000-4000-9000-000000000010',
 5,'2026-10-15',null
);
select public.set_empty_crate_count(
 '88000000-0000-4000-8000-000000000053',
 '88000000-0000-4000-9000-000000000010',
 5,'2026-10-15',null
);
select public.receive_stock(
 '88000000-0000-4000-8000-000000000054',
 '88000000-0000-4000-9000-000000000020',
 2,60,5,12,
 '88000000-0000-4000-9000-000000000010','2026-10-15'
);
select public.receive_stock(
 '88000000-0000-4000-8000-000000000054',
 '88000000-0000-4000-9000-000000000020',
 2,60,5,12,
 '88000000-0000-4000-9000-000000000010','2026-10-15'
);

-- Onboarding obligations are separate from day-to-day sales revenue.
select public.record_opening_balances(
 '88000000-0000-4000-8000-000000000055',
 '88000000-0000-4000-9000-000000000031',
 1500,'2026-10-15','Verified previous debt','[]'::jsonb,'[]'::jsonb
);
select public.record_opening_balances(
 '88000000-0000-4000-8000-000000000055',
 '88000000-0000-4000-9000-000000000031',
 1500,'2026-10-15','Verified previous debt','[]'::jsonb,'[]'::jsonb
);
reset role;

do $integrity$
declare v_business uuid; v_r record;
begin
 select id into strict v_business from private.businesses
 where legacy_singleton is true;
 if (select amount from public.money_owed where
   customer_id='88000000-0000-4000-9000-000000000030')<>2000 then
   raise exception 'Combined checkout did not preserve old-debt payments';
 end if;
 if (select total_bottles from public.stock where
   product_id='88000000-0000-4000-9000-000000000020')<>84 then
   raise exception 'Stock count and receiving changed stock incorrectly';
 end if;
 if (select count(*) from public.customer_payments where
   request_id='88000000-0000-4000-8000-000000000040')<>1
   or (select count(*) from public.sales where
   request_id='88000000-0000-4000-8000-000000000050')<>1 then
   raise exception 'Idempotent payment or sale was duplicated';
 end if;
 if (select count(*) from public.sales where
    request_id='88000000-0000-4000-8000-000000000051')<>1
    or (select count(*) from public.customer_payments where
    customer_id='88000000-0000-4000-9000-000000000030')<>2 then
   raise exception 'Combined checkout duplicated a sale or old debt payment';
 end if;
 if not exists (
   select 1 from public.sales s where
   s.request_id='88000000-0000-4000-8000-000000000051'
     and s.account_receipt->>'bd'='2500'
     and s.account_receipt->>'cd'='2000'
 ) then
   raise exception 'Combined checkout customer statement snapshot changed';
 end if;
 if (select count(*) from public.stock_movements where
    request_id in (
      '88000000-0000-4000-8000-000000000052',
      '88000000-0000-4000-8000-000000000054'
    ))<>2
    or (select count(*) from public.empty_crate_movements
      where request_id='88000000-0000-4000-8000-000000000053')<>1
    or (select count(*) from private.stock_receipts
      where request_id='88000000-0000-4000-8000-000000000054')<>1
    or (select quantity from public.empty_crate_stock
      where crate_type_id='88000000-0000-4000-9000-000000000010')<>3 then
   raise exception 'M2d count/receive/empties ledger or idempotency failed';
 end if;
 if (select count(*) from public.customer_opening_balances where
    request_id='88000000-0000-4000-8000-000000000055')<>1
   or (select amount from public.money_owed
    where customer_id='88000000-0000-4000-9000-000000000031')<>1500 then
   raise exception 'M2d opening debt duplicated or changed';
 end if;
 if not exists(
   select 1 from public.customer_payments where
     request_id='88000000-0000-4000-8000-000000000040'
       and business_id=v_business and amount=1000
 ) or not exists(
   select 1 from public.sale_items
   where sale_id=(select id from public.sales where
     request_id='88000000-0000-4000-8000-000000000050')
     and business_id=v_business
 ) then raise exception 'Financial transaction records were not tenant tagged'; end if;
 for v_r in select * from private.legacy_scope_tables() loop
   if (private.legacy_scope_snapshot()->
       (v_r.schema_name||'.'||v_r.table_name)->>'unassigned')::bigint<>0 then
      raise exception 'M2d wrote NULL business identity on %.%',
        v_r.schema_name,v_r.table_name;
   end if;
 end loop;
end;
$integrity$;

-- A second depot may exist in setup, but this stage must NOT grant it access.
insert into private.businesses(id,status)
values ('88000000-0000-4000-9000-000000000099','setup');

do $adversarial$
declare v_business uuid; v_other uuid;
begin
 select id into strict v_business from private.businesses
   where legacy_singleton is true;
 v_other:='88000000-0000-4000-9000-000000000099';
 perform set_config('request.jwt.claim.sub',
   '88000000-0000-4000-8000-000000000001',true);
 begin
   insert into public.customers(id,name,phone,business_id)
   values ('88000000-0000-4000-9000-000000000032',
      'Forged tenant','08000008003',v_other);
   raise exception 'A forged business identity was accepted'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
   update public.customers set business_id=v_other
   where id='88000000-0000-4000-9000-000000000030';
   raise exception 'Historical customer business_id could be changed'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
   update public.customers set business_id=null
   where id='88000000-0000-4000-9000-000000000030';
   raise exception 'Historical business_id could be erased'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 -- Disabled membership must deny the original owner as well.
 update private.business_memberships set status='disabled'
   where business_id=v_business;
 begin
   perform public.delete_unused_crate_type(
     '88000000-0000-4000-8000-000000000081');
   raise exception 'Disabled owner deleted an empty crate type'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
   update public.product_catalogue
     set image_path='catalogue/88000000-0000-4000-9000-000000000090/88000000-0000-4000-8000-000000000092.webp'
   where id='88000000-0000-4000-9000-000000000090';
   raise exception 'Disabled owner edited a shared catalogue photo'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 if not exists(
   select 1 from public.crate_types where
     id='88000000-0000-4000-8000-000000000081'
 ) or (select image_path from public.product_catalogue
    where id='88000000-0000-4000-9000-000000000090')
    is distinct from
    'catalogue/88000000-0000-4000-9000-000000000090/88000000-0000-4000-8000-000000000091.webp' then
   raise exception 'Revoked owner changed the crate or shared catalogue';
 end if;
 begin
   insert into public.customers(id,name,phone)
   values ('88000000-0000-4000-9000-000000000033',
      'Disabled owner','08000008004');
   raise exception 'Disabled owner kept write privileges'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 update private.business_memberships set status='active'
   where business_id=v_business;
 perform set_config('request.jwt.claim.sub',
   '88000000-0000-4000-8000-000000000002',true);
 begin
   insert into public.customers(id,name,phone)
   values ('88000000-0000-4000-9000-000000000034',
      'Second owner bypass','08000008005');
   raise exception 'Another Auth user wrote legacy shop data'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 perform set_config('request.jwt.claim.sub','',true);
 begin
   insert into public.customers(id,name,phone)
   values ('88000000-0000-4000-9000-000000000035',
      'Anonymous system write','08000008006');
   raise exception 'Unscoped operation was accepted'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 if exists(select 1 from public.customers where name like 'Forged%'
     or name like 'Disabled%' or name like 'Second owner%'
     or name like 'Anonymous system%') then
   raise exception 'A rejected write left an operational record behind';
 end if;
end;
$adversarial$;
rollback;
