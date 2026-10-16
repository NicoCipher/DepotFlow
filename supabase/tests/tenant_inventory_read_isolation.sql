-- M2f-1: disposable PostgreSQL owner/business isolation for the EXISTING
-- product, stock and exact branded empties tables. No new shop write path.
begin;
insert into auth.users(id) values
 ('89600000-0000-4000-8000-000000000001'),
 ('89600000-0000-4000-8000-000000000002'),
 ('89600000-0000-4000-8000-000000000003');
insert into private.shop_owner(user_id)
 values ('89600000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();

insert into public.crate_types(id,name,empty_family,pocket_count)
values ('89600000-0000-4000-9000-000000000011','Goldberg NB12','NB',12);
insert into public.products(
 id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id
) values (
 '89600000-0000-4000-9000-000000000021','Legacy Goldberg',12,12000,false,
 '89600000-0000-4000-9000-000000000011'
);
insert into public.stock(product_id,total_bottles)
 values ('89600000-0000-4000-9000-000000000021',120);
insert into public.empty_crate_stock(crate_type_id,quantity)
 values ('89600000-0000-4000-9000-000000000011',3);
insert into public.empty_bottle_stock(bottle_type,quantity)
 values ('Legacy Goldberg bottles',5);

create function pg_temp.assert_true(ok boolean,info text)
returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',info;end if;end;
$$;

-- Original owner continues receiving correctly scoped inventory reads
-- before the legacy business_id backfill.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true(
 (select count(*)=1 from public.products) and
 (select count(*)=1 from public.stock) and
 (select count(*)=1 from public.crate_types) and
 (select quantity=3 from public.empty_crate_stock),
 'Preactivation owner lost legacy inventory or branded crate details');
reset role;

-- Explicit legacy migration sequence. Must run BEFORE any new owner exists.
select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate$
declare r record;v_count integer:=0;
begin
 for r in
  select n.nspname s,c.relname t,k.conname name
  from pg_constraint k
  join pg_class c on c.oid=k.conrelid
  join pg_namespace n on n.oid=c.relnamespace
  join private.legacy_scope_tables() tab
    on tab.schema_name=n.nspname and tab.table_name=c.relname
  where k.contype='f' and left(k.conname,7)='tenant_'
 loop
  execute format('alter table %I.%I validate constraint %I',
    r.s,r.t,r.name);
  v_count:=v_count+1;
 end loop;
 if v_count<>31 then raise exception 'Missing validated tenant FKs: %',v_count; end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

-- After activation, separately provision A and B owner records as test
-- admin. A genuine registration API is NOT introduced in this PR.
insert into private.businesses(id,status) values
 ('89600000-0000-4000-9000-000000000041','active'),
 ('89600000-0000-4000-9000-000000000042','active');
insert into private.business_memberships(business_id,user_id,status,member_kind)
values
 ('89600000-0000-4000-9000-000000000041',
  '89600000-0000-4000-8000-000000000002','active','owner'),
 ('89600000-0000-4000-9000-000000000042',
  '89600000-0000-4000-8000-000000000003','active','owner');

-- Simulate a future business-tagged assortment and physical inventory.
-- Direct operational writes for new owners remain blocked. Only the
-- disposable superuser temporarily suspends the named legacy write trigger
-- on four tables to build FOREIGN fixtures, then re-enables it immediately.
alter table public.crate_types disable trigger legacy_scope_business_write;
alter table public.products disable trigger legacy_scope_business_write;
alter table public.stock disable trigger legacy_scope_business_write;
alter table public.empty_crate_stock disable trigger legacy_scope_business_write;
alter table public.empty_bottle_stock disable trigger legacy_scope_business_write;

insert into public.crate_types(id,name,empty_family,pocket_count,business_id)
values
 ('89600000-0000-4000-9000-000000000012','Heineken 12-pocket','NB',12,
  '89600000-0000-4000-9000-000000000041'),
 ('89600000-0000-4000-9000-000000000013','Gulder 12-pocket','NB',12,
  '89600000-0000-4000-9000-000000000042');
insert into public.products(
 id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id,business_id
) values
 ('89600000-0000-4000-9000-000000000022','A Heineken',12,15000,false,
  '89600000-0000-4000-9000-000000000012',
  '89600000-0000-4000-9000-000000000041'),
 ('89600000-0000-4000-9000-000000000023','B Gulder',12,13000,false,
  '89600000-0000-4000-9000-000000000013',
  '89600000-0000-4000-9000-000000000042');
insert into public.stock(product_id,total_bottles,business_id)
values
 ('89600000-0000-4000-9000-000000000022',72,
  '89600000-0000-4000-9000-000000000041'),
 ('89600000-0000-4000-9000-000000000023',0,
  '89600000-0000-4000-9000-000000000042');
insert into public.empty_crate_stock(crate_type_id,quantity,business_id)
values
 ('89600000-0000-4000-9000-000000000012',7,
  '89600000-0000-4000-9000-000000000041'),
 ('89600000-0000-4000-9000-000000000013',2,
  '89600000-0000-4000-9000-000000000042');
insert into public.empty_bottle_stock(bottle_type,quantity,business_id)
values
 ('A-only bottle',9,'89600000-0000-4000-9000-000000000041'),
 ('B-only bottle',4,'89600000-0000-4000-9000-000000000042');

alter table public.crate_types enable trigger legacy_scope_business_write;
alter table public.products enable trigger legacy_scope_business_write;
alter table public.stock enable trigger legacy_scope_business_write;
alter table public.empty_crate_stock enable trigger legacy_scope_business_write;
alter table public.empty_bottle_stock enable trigger legacy_scope_business_write;

-- The original owner cannot read either new shop, despite previously
-- global owner_read SELECT policies. The two SAME-pocket crate types keep
-- separate exact identities and quantities.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true(
 (select count(*)=1 from public.products)
 and (select name='Legacy Goldberg' from public.products limit 1)
 and (select count(*)=1 from public.stock)
 and (select total_bottles=120 from public.stock limit 1)
 and (select count(*)=1 from public.crate_types)
 and (select quantity=3 from public.empty_crate_stock limit 1)
 and (select count(*)=1 from public.empty_bottle_stock),
 'Legacy owner sees a new business inventory row or lost its own');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true(
 (select count(*)=1 from public.products)
 and (select name='A Heineken' from public.products limit 1)
 and (select count(*)=1 from public.stock)
 and (select total_bottles=72 from public.stock limit 1)
 and (select count(*)=1 from public.crate_types)
 and (select name='Heineken 12-pocket' from public.crate_types limit 1)
 and (select quantity=7 from public.empty_crate_stock limit 1)
 and (select quantity=9 from public.empty_bottle_stock limit 1)
 and not public.is_shop_owner(),
 'A owner sees B/legacy records or incorrectly becomes legacy owner');

do $no_mutation$
begin
 begin
  insert into public.products(
   id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id,
   business_id
  ) values (
   '89600000-0000-4000-9000-000000000024','Forged B stock',12,16000,false,
   '89600000-0000-4000-9000-000000000013',
   '89600000-0000-4000-9000-000000000042'
  );
  raise exception 'A created B product in incomplete inventory subsystem'
    using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
  update public.stock set total_bottles=999
   where product_id='89600000-0000-4000-9000-000000000022';
  raise exception 'A mutated stock without inventory RPC release'
    using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$no_mutation$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true(
 (select count(*)=1 from public.products)
 and (select name='B Gulder' from public.products limit 1)
 and (select total_bottles=0 from public.stock limit 1)
 and (select name='Gulder 12-pocket' from public.crate_types limit 1)
 and (select quantity=2 from public.empty_crate_stock limit 1)
 and (select quantity=4 from public.empty_bottle_stock limit 1),
 'B owner sees A/legacy inventory or cannot see its exact crate');
reset role;

-- Losing membership immediately revokes read access, with no modification
-- of stock or empty bottle balances.
update private.business_memberships set status='disabled'
where business_id='89600000-0000-4000-9000-000000000041';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true(
 not exists(select 1 from public.products)
 and not exists(select 1 from public.stock)
 and not exists(select 1 from public.crate_types)
 and not exists(select 1 from public.empty_crate_stock)
 and not exists(select 1 from public.empty_bottle_stock),
 'Disabled owner can still see physical inventory');
reset role;

do $unchanged$
begin
 if (select count(*) from public.products)<>3
 or (select count(*) from public.crate_types)<>3
 or (select count(*) from public.stock)<>3
 or (select count(*) from public.empty_crate_stock)<>3
 or (select count(*) from public.empty_bottle_stock)<>3
 or (select total_bottles from public.stock where
   product_id='89600000-0000-4000-9000-000000000022')<>72
 or (select quantity from public.empty_crate_stock where
   crate_type_id='89600000-0000-4000-9000-000000000012')<>7 then
   raise exception 'Cross-business RLS or revoked-owner test changed inventory';
 end if;
end;
$unchanged$;
rollback;
