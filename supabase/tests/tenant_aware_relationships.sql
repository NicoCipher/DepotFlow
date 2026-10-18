-- M2c: same-business FK enforcement on all existing shop-owned relations.
-- Disposable PG16 only; every fixture and VALIDATE operation rolls back.
begin;

-- Audit every newly-created pair: no original FK may lack its tenant twin.
do $metadata$
declare
  r record;
  v_total integer:=0;
  v_business_child smallint;
  v_business_parent smallint;
  v_tenant record;
begin
  for r in
    select base.* from pg_constraint base
    where base.contype='f'
      and base.confrelid in (
        'public.customers'::regclass,
        'public.crate_types'::regclass,
        'public.products'::regclass,
        'public.sales'::regclass,
        'public.sale_empty_decisions'::regclass
      )
      and pg_catalog.array_length(base.conkey,1)=1
      and exists (
        select 1 from private.legacy_scope_tables() scope
        join pg_class cls
          on cls.relname=scope.table_name
        join pg_namespace ns
          on ns.oid=cls.relnamespace and ns.nspname=scope.schema_name
        where cls.oid=base.conrelid
      )
      and base.conname not like 'tenant_%'
  loop
    select attnum into strict v_business_child from pg_attribute
      where attrelid=r.conrelid and attname='business_id' and not attisdropped;
    select attnum into strict v_business_parent from pg_attribute
      where attrelid=r.confrelid and attname='business_id' and not attisdropped;
    select * into v_tenant from pg_constraint t
      where t.conrelid=r.conrelid
        and t.confrelid=r.confrelid and t.contype='f'
        and t.conname='tenant_'||r.conname;
    if not found then
      raise exception 'Missing composite FK for original: %',r.conname;
    end if;
    if v_tenant.conkey <> array[v_business_child,r.conkey[1]]::smallint[]
       or v_tenant.confkey <> array[v_business_parent,r.confkey[1]]::smallint[]
       or v_tenant.convalidated is true then
      raise exception 'Incorrect M2c FK columns or validation gate: %',r.conname;
    end if;
    v_total := v_total+1;
  end loop;
  if v_total<>31 then
    raise exception 'M2c expected 31 matched composite foreign keys; found %',v_total;
  end if;
  if exists(select 1 from information_schema.columns
      where table_schema='public' and table_name='product_catalogue'
        and column_name='business_id') then
    raise exception 'Shared master catalogue incorrectly became shop-owned';
  end if;
end;
$metadata$;

insert into private.businesses(id,status) values
 ('87000000-0000-4000-9000-000000000001','setup'),
 ('87000000-0000-4000-9000-000000000002','setup');

insert into public.customers(id,name,phone,business_id) values
 ('87000000-0000-4000-8000-000000000011','M2c A','08000000011',
  '87000000-0000-4000-9000-000000000001'),
 ('87000000-0000-4000-8000-000000000012','M2c B','08000000012',
  '87000000-0000-4000-9000-000000000002');

insert into public.crate_types(id,name,empty_family,pocket_count,business_id) values
 ('87000000-0000-4000-8000-000000000021','M2c A crate','M2c A',12,
  '87000000-0000-4000-9000-000000000001'),
 ('87000000-0000-4000-8000-000000000022','M2c B crate','M2c B',12,
  '87000000-0000-4000-9000-000000000002');

insert into public.products(
 id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id,business_id
) values
 ('87000000-0000-4000-8000-000000000031','M2c A drink',12,12000,false,
  '87000000-0000-4000-8000-000000000021',
  '87000000-0000-4000-9000-000000000001'),
 ('87000000-0000-4000-8000-000000000032','M2c B drink',12,12000,false,
  '87000000-0000-4000-8000-000000000022',
  '87000000-0000-4000-9000-000000000002');

insert into public.stock(product_id,total_bottles,business_id)
values ('87000000-0000-4000-8000-000000000031',24,
        '87000000-0000-4000-9000-000000000001');

insert into public.sales(id,customer_id,total_amount,paid_amount,business_id) values
 ('87000000-0000-4000-8000-000000000041',
  '87000000-0000-4000-8000-000000000011',12000,0,
  '87000000-0000-4000-9000-000000000001');

insert into public.sale_items(
 id,sale_id,product_id,product_name,total_bottles,bottles_per_crate,
 line_total,bottles_returnable,crate_type_id,business_id
) values (
 '87000000-0000-4000-8000-000000000051',
 '87000000-0000-4000-8000-000000000041',
 '87000000-0000-4000-8000-000000000031','M2c A drink',
 12,12,12000,false,'87000000-0000-4000-8000-000000000021',
 '87000000-0000-4000-9000-000000000001'
);

insert into public.bottle_obligations(customer_id,bottle_type,quantity,business_id)
values ('87000000-0000-4000-8000-000000000011','M2c bottle',1,
        '87000000-0000-4000-9000-000000000001');

insert into private.stock_receipts(
 request_id,product_id,crates,stock_after,empties_after,crate_type_id,business_id
) values (
 '87000000-0000-4000-8000-000000000061',
 '87000000-0000-4000-8000-000000000031',1,24,0,
 '87000000-0000-4000-8000-000000000021',
 '87000000-0000-4000-9000-000000000001'
);

-- Every negative probe uses a globally valid UUID; only the business mismatch
-- makes it fail. Invalid rows must not remain after the caught exception.
do $negative$
declare
  v_a uuid:='87000000-0000-4000-9000-000000000001';
  v_b uuid:='87000000-0000-4000-9000-000000000002';
  v_message text;
begin
  -- A payment/debt/obligation cannot refer to a customer of another depot.
  begin
    insert into public.money_owed(customer_id,amount,business_id)
    values ('87000000-0000-4000-8000-000000000011',500,v_b);
    raise exception 'M2c allowed cross-depot debt' using errcode='PT001';
  exception when foreign_key_violation then null; end;

  -- A sale cannot use another business's customer.
  begin
    insert into public.sales(id,customer_id,total_amount,paid_amount,business_id)
    values ('87000000-0000-4000-8000-000000000042',
      '87000000-0000-4000-8000-000000000011',12000,0,v_b);
    raise exception 'M2c allowed cross-depot sale' using errcode='PT001';
  exception when foreign_key_violation then null; end;

  -- A product must be assigned to a crate identity from its own business.
  begin
    insert into public.products(
      id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id,business_id
    ) values ('87000000-0000-4000-8000-000000000033',
      'M2c cross crate',12,12000,false,
      '87000000-0000-4000-8000-000000000022',v_a);
    raise exception 'M2c allowed cross-depot product/crate pair' using errcode='PT001';
  exception when foreign_key_violation then null; end;

  -- A stock row cannot contain another business's product.
  begin
    insert into public.stock(product_id,total_bottles,business_id)
    values ('87000000-0000-4000-8000-000000000032',24,v_a);
    raise exception 'M2c allowed cross-depot stock' using errcode='PT001';
  exception when foreign_key_violation then null; end;

  -- Even with a valid sale and product ID, line items cannot mix owners.
  begin
    insert into public.sale_items(
      id,sale_id,product_id,product_name,total_bottles,bottles_per_crate,
      line_total,bottles_returnable,crate_type_id,business_id
    ) values (
      '87000000-0000-4000-8000-000000000052',
      '87000000-0000-4000-8000-000000000041',
      '87000000-0000-4000-8000-000000000032','M2c wrong product',
      12,12,12000,false,
      '87000000-0000-4000-8000-000000000021',v_a
    );
    raise exception 'M2c allowed foreign sale line product' using errcode='PT001';
  exception when foreign_key_violation then null; end;

  -- A customer's missing-crate ledger cannot identify another shop's crate.
  begin
    insert into public.crate_obligations(
      customer_id,crate_type,crate_type_id,quantity,business_id
    ) values ('87000000-0000-4000-8000-000000000011',
      'M2c B crate','87000000-0000-4000-8000-000000000022',1,v_a);
    raise exception 'M2c allowed foreign crate debt' using errcode='PT001';
  exception when foreign_key_violation then null; end;

  -- A stock receipt cannot claim another business's drink.
  begin
    insert into private.stock_receipts(
      request_id,product_id,crates,stock_after,empties_after,crate_type_id,business_id
    ) values ('87000000-0000-4000-8000-000000000062',
      '87000000-0000-4000-8000-000000000032',1,24,0,
      '87000000-0000-4000-8000-000000000021',v_a);
    raise exception 'M2c allowed foreign stock receipt' using errcode='PT001';
  exception when foreign_key_violation then null; end;

  -- A saved receipt line's business cannot be rewritten independently.
  begin
    update public.sale_items set business_id=v_b
    where id='87000000-0000-4000-8000-000000000051';
    raise exception 'M2c allowed reassigning historical sale line' using errcode='PT001';
  exception when foreign_key_violation then null; end;

  -- A parent referenced by another tagged row cannot change business.
  begin
    update public.products set business_id=v_b
    where id='87000000-0000-4000-8000-000000000031';
    raise exception 'M2c allowed moving referenced product' using errcode='PT001';
  exception when foreign_key_violation then null; end;

  if (select count(*) from public.sale_items
      where business_id=v_a and sale_id='87000000-0000-4000-8000-000000000041')<>1
     or (select count(*) from public.sales
      where business_id=v_a and customer_id='87000000-0000-4000-8000-000000000011')<>1
     or (select count(*) from public.money_owed
      where customer_id='87000000-0000-4000-8000-000000000011')<>0 then
    raise exception 'Rejected cross-depot write left data behind';
  end if;
end;
$negative$;

-- The existing owner-only system still writes rows with NULL tenant IDs.
-- Composite FKs must not break the pilot until M2d migrates every writer.
insert into public.customers(id,name,phone)
values ('87000000-0000-4000-8000-000000000071','Legacy nullable','08000000071');
insert into public.money_owed(customer_id,amount)
values ('87000000-0000-4000-8000-000000000071',500);
do $legacy$
begin
 if (select count(*) from public.money_owed
     where business_id is null and customer_id='87000000-0000-4000-8000-000000000071')<>1 then
   raise exception 'Existing singleton shop compatibility was broken';
 end if;
end;
$legacy$;

-- VALIDATE against known-good fixtures (test transaction only): production
-- must validate after M2b backfill and tenant-RPC completeness reconciliation.
-- The newer mixed-tender ledger adds a deferred SALE INSERT trigger.
-- Flush its pending event before the in-transaction ALTER TABLE VALIDATE;
-- then restore deferral for any subsequent atomic mixed-tender writes.
set constraints all immediate;
do $validate$
declare r record; v_count int:=0;
begin
  for r in select ns.nspname as sch, cls.relname as tab, con.conname as constraint_name
    from pg_constraint con
    join pg_class cls on cls.oid=con.conrelid
    join pg_namespace ns on ns.oid=cls.relnamespace
    where con.contype='f' and con.conname like 'tenant_%'
  loop
    execute pg_catalog.format(
      'alter table %I.%I validate constraint %I',r.sch,r.tab,r.constraint_name);
    v_count := v_count+1;
  end loop;
  if v_count<>31 then
    raise exception 'Expected 31 validated tenant relationships, got %',v_count;
  end if;
end;
$validate$;
set constraints all deferred;
rollback;
