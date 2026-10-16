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

insert into public.product_catalogue(id,name,manufacturer,image_path)
values (
 '89600000-0000-4000-9000-000000000010',
 'Shared Gold Lager','NB','first-party/shared-gold.webp'
);
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
 (select quantity=3 from public.empty_crate_stock)
 and (select count(*)=1 from public.product_catalogue),
 'Preactivation owner lost legacy inventory or shared master catalogue');
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

-- Seed only disposable FOREIGN movements and one foreign outstanding debt.
-- Operational stock/debt functions remain forbidden to new business owners.
-- This exercises the privileged manager/activity RPCs that bypass RLS.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000003',true);
insert into public.customers(id,name,phone,business_id)
values ('89600000-0000-4000-9000-000000000061',
 'B-only customer','08000896061',
 '89600000-0000-4000-9000-000000000042');
reset role;

alter table public.money_owed disable trigger legacy_scope_business_write;
alter table public.stock_movements disable trigger legacy_scope_business_write;
alter table public.empty_crate_movements disable trigger legacy_scope_business_write;
insert into public.money_owed(customer_id,amount,business_id)
values ('89600000-0000-4000-9000-000000000061',
 9999,'89600000-0000-4000-9000-000000000042');
insert into public.stock_movements(
  id,product_id,movement_type,quantity_change,resulting_stock,
  business_date,request_id,crates,loose_bottles,bottles_per_crate,
  product_name,crate_type_id,business_id
) values (
  '89600000-0000-4000-9000-000000000071',
  '89600000-0000-4000-9000-000000000023',
  'count',0,0,'2026-10-16',
  '89600000-0000-4000-9000-000000000072',
  0,0,12,'B-only stock movement',
  '89600000-0000-4000-9000-000000000013',
  '89600000-0000-4000-9000-000000000042'
);
insert into public.empty_crate_movements(
  id,crate_type,movement_type,previous_quantity,quantity_change,
  resulting_quantity,business_date,request_id,crate_type_id,business_id
) values (
  '89600000-0000-4000-9000-000000000073',
  'B Gulder 12-pocket','count',0,2,2,'2026-10-16',
  '89600000-0000-4000-9000-000000000074',
  '89600000-0000-4000-9000-000000000013',
  '89600000-0000-4000-9000-000000000042'
);
alter table public.money_owed enable trigger legacy_scope_business_write;
alter table public.stock_movements enable trigger legacy_scope_business_write;
alter table public.empty_crate_movements enable trigger legacy_scope_business_write;

-- Positive original-shop report plus negative foreign inventory/financial
-- probes; a SECURITY DEFINER function cannot rely on the table's RLS.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000001',true);
do $privileged_legacy_reports$
declare v_dashboard jsonb; v_activity jsonb;
begin
 v_dashboard:=public.manager_snapshot('2026-10-16');
 if (v_dashboard->>'low_stock')::integer<>0
  or (v_dashboard->>'missing_counts')::integer<>0
  or (v_dashboard->>'outstanding')::integer<>0
  or (v_dashboard->>'customers_owing')::integer<>0 then
  raise exception 'Dashboard aggregates leaked B inventory/debt: %',
   v_dashboard;
 end if;
 v_activity:=public.store_activity(
  '2026-10-15','2026-10-17',null,'all',100,0
 );
 if pg_catalog.strpos(v_activity::text,'B-only stock movement')<>0
   or pg_catalog.strpos(v_activity::text,'B Gulder 12-pocket')<>0
   or (v_activity->>'count')::integer<>0 then
  raise exception 'Privileged activity reader leaked B movement: %',
   v_activity;
 end if;
end;
$privileged_legacy_reports$;
reset role;

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
 and (select count(*)=1 from public.empty_bottle_stock)
 and (select name='Shared Gold Lager' from public.product_catalogue limit 1),
 'Legacy owner sees another shop inventory or lost shared master catalogue');
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
 and (select count(*)=1 from public.product_catalogue)
 and (select manufacturer='NB' from public.product_catalogue limit 1)
 and not public.is_shop_owner(),
 'A owner saw B/legacy inventory or lost shared master catalogue');

do $no_mutation$
declare v_updated integer;
begin
 update public.product_catalogue set image_path='first-party/unauthorized.webp'
 where id='89600000-0000-4000-9000-000000000010';
 get diagnostics v_updated=row_count;
 if v_updated<>0 then
   raise exception 'New business altered global master catalogue';
 end if;
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
 and (select quantity=4 from public.empty_bottle_stock limit 1)
 and (select count(*)=1 from public.product_catalogue),
 'B owner sees A/legacy inventory or cannot browse shared master');
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
 and not exists(select 1 from public.empty_bottle_stock)
 and not exists(select 1 from public.stock_movements)
 and not exists(select 1 from public.empty_crate_movements)
 and not exists(select 1 from public.product_catalogue),
 'Disabled owner can still see physical inventory or shared master');
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
