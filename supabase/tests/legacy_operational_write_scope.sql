-- M2d-1 verification on a disposable PG16 database only.
-- All fixtures, payments, sales, and ownership changes roll back.
begin;

insert into auth.users(id) values
 ('88000000-0000-4000-8000-000000000001'),
 ('88000000-0000-4000-8000-000000000002');
insert into private.shop_owner(user_id)
values ('88000000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();

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

do $preflight$
declare v_snapshot jsonb; v_err text;
begin
  if (select count(*) from pg_trigger
      where tgname='legacy_scope_business_write' and not tgisinternal)<>29 then
    raise exception 'M2d did not install all 29 operational write triggers';
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
    if v_err not like 'All historical rows%' and
       v_err not like '31 M2c tenant%' then
      raise exception 'Unexpected enable failure: %',v_err;
    end if;
  end;
end;
$preflight$;

-- Explicit backfill, exactly as the reviewed M2b admin workflow requires.
select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());

-- Deliberately validate the 31 previously unvalidated M2c FKs on the
-- disposable database; production must run this as a separate release gate.
do $validate$
declare r record; v_count integer:=0;
begin
 for r in select ns.nspname s, cls.relname t, c.conname k
   from pg_constraint c
   join pg_class cls on cls.oid=c.conrelid
   join pg_namespace ns on ns.oid=cls.relnamespace
   where c.contype='f' and c.conname like 'tenant_%'
 loop
   execute pg_catalog.format('alter table %I.%I validate constraint %I',
     r.s,r.t,r.k);
   v_count:=v_count+1;
 end loop;
 if v_count<>31 then
   raise exception 'Expected 31 validated business FKs, got %',v_count;
 end if;
end;
$validate$;

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
reset role;

do $integrity$
declare v_business uuid; v_r record;
begin
 select id into strict v_business from private.businesses
 where legacy_singleton is true;
 if (select amount from public.money_owed where
   customer_id='88000000-0000-4000-9000-000000000030')<>2500 then
   raise exception 'Combined debt and sale were not recorded correctly';
 end if;
 if (select total_bottles from public.stock where
   product_id='88000000-0000-4000-9000-000000000020')<>119 then
   raise exception 'Sale changed stock incorrectly';
 end if;
 if (select count(*) from public.customer_payments where
   request_id='88000000-0000-4000-8000-000000000040')<>1
   or (select count(*) from public.sales where
   request_id='88000000-0000-4000-8000-000000000050')<>1 then
   raise exception 'Idempotent payment or sale was duplicated';
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
