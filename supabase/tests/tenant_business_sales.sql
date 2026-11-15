-- Rollback-only tenant business sale writer coverage.
begin;

insert into auth.users(id) values
 ('89e00000-0000-4000-8000-000000000001'),
 ('89e00000-0000-4000-8000-000000000002'),
 ('89e00000-0000-4000-8000-000000000003'),
 ('89e00000-0000-4000-8000-000000000004');
insert into private.shop_owner(user_id)
 values('89e00000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
insert into public.customers(id,name,phone) values(
 '89e00000-0000-4000-9000-000000000011','Legacy sale fixture','08000890011');
select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());

do $validate$
declare r record;n int:=0;
begin
 for r in select ns.nspname s,c.relname t,k.conname
 from pg_constraint k
 join pg_class c on c.oid=k.conrelid
 join pg_namespace ns on ns.oid=c.relnamespace
 join private.legacy_scope_tables() tab
   on tab.schema_name=ns.nspname and tab.table_name=c.relname
 where k.contype='f' and left(k.conname,7)='tenant_'
 loop
  execute format('alter table %I.%I validate constraint %I',r.s,r.t,r.conname);
  n:=n+1;
 end loop;
 if n<>31 then raise exception 'Missing 31 tenant FKs, got %',n;end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

insert into private.businesses(id,status) values
 ('89e00000-0000-4000-9000-000000000021','setup'),
 ('89e00000-0000-4000-9000-000000000022','setup');
insert into private.business_memberships(business_id,user_id,status,member_kind) values
 ('89e00000-0000-4000-9000-000000000021','89e00000-0000-4000-8000-000000000002','active','owner'),
 ('89e00000-0000-4000-9000-000000000022','89e00000-0000-4000-8000-000000000003','active','owner');

insert into public.business_profiles(business_id,name,address,phone) values
 ('89e00000-0000-4000-9000-000000000021','Depot A','1 A Road, Lagos','08000890021'),
 ('89e00000-0000-4000-9000-000000000022','Depot B','2 B Road, Lagos','08000890022');

-- Admin-only fixture inserts. The operational write trigger is re-enabled
-- before any authenticated business sale is attempted.
alter table public.crate_types disable trigger legacy_scope_business_write;
alter table public.products disable trigger legacy_scope_business_write;
alter table public.customers disable trigger legacy_scope_business_write;
alter table public.stock disable trigger legacy_scope_business_write;

insert into public.crate_types(id,business_id,name,empty_family,pocket_count) values
 ('89e00000-0000-4000-9000-000000000031','89e00000-0000-4000-9000-000000000021','A return crate','NBL',20),
 ('89e00000-0000-4000-9000-000000000032','89e00000-0000-4000-9000-000000000022','B return crate','NBL',20);

insert into public.products(
 id,business_id,name,size,bottles_per_crate,full_crate_price,half_crate_price,
 quarter_crate_price,bottle_price,bottles_returnable,empty_family,crate_type,
 bottle_type,crate_type_id,is_active
) values
 ('89e00000-0000-4000-9000-000000000041','89e00000-0000-4000-9000-000000000021',
  'A Lager','50cl',20,8000,4000,2000,500,true,'NBL','A return crate','A return bottle',
  '89e00000-0000-4000-9000-000000000031',true),
 ('89e00000-0000-4000-9000-000000000042','89e00000-0000-4000-9000-000000000022',
  'B Lager','50cl',20,9000,4500,2250,550,true,'NBL','B return crate','B return bottle',
  '89e00000-0000-4000-9000-000000000032',true);

insert into public.customers(id,name,phone,business_id,empties_deposit_required) values
 ('89e00000-0000-4000-9000-000000000051','A Customer','08000890051','89e00000-0000-4000-9000-000000000021',false),
 ('89e00000-0000-4000-9000-000000000052','B Customer','08000890052','89e00000-0000-4000-9000-000000000022',false),
 ('89e00000-0000-4000-9000-000000000053','A Returns Customer','08000890053','89e00000-0000-4000-9000-000000000021',false);

insert into public.stock(product_id,total_bottles,business_id) values
 ('89e00000-0000-4000-9000-000000000041',40,'89e00000-0000-4000-9000-000000000021'),
 ('89e00000-0000-4000-9000-000000000042',40,'89e00000-0000-4000-9000-000000000022');

alter table public.crate_types enable trigger legacy_scope_business_write;
alter table public.products enable trigger legacy_scope_business_write;
alter table public.customers enable trigger legacy_scope_business_write;
alter table public.stock enable trigger legacy_scope_business_write;

update private.businesses set status='active'
where id in ('89e00000-0000-4000-9000-000000000021','89e00000-0000-4000-9000-000000000022');

do $default_off$
begin
 if (select enabled from private.business_sales_gate where singleton)
    is distinct from false then
  raise exception 'Business sales gate must default OFF';
 end if;
 if has_table_privilege('authenticated','public.sales','INSERT')
    or has_table_privilege('authenticated','public.sale_items','INSERT')
    or has_table_privilege('authenticated','public.stock','UPDATE')
    or has_table_privilege('authenticated','public.money_owed','UPDATE') then
  raise exception 'Authenticated role received direct business sales DML';
 end if;
 if has_function_privilege('anon',
   'public.save_business_sale_v2(uuid,uuid,uuid,date,numeric,text,jsonb,jsonb,jsonb)',
   'EXECUTE') then
  raise exception 'Anonymous role can execute business sale RPC';
 end if;
end;
$default_off$;

set local role authenticated;
select set_config('request.jwt.claim.sub','89e00000-0000-4000-8000-000000000002',true);
do $gate_off$
declare v jsonb;
begin
 begin
  v:=public.save_business_sale_v2(
   '89e00000-0000-4000-9000-000000000021',
   '89e00000-0000-4000-9000-000000000061',
   '89e00000-0000-4000-9000-000000000051',
   (pg_catalog.now() at time zone 'Africa/Lagos')::date,
   3000,'cash',
   '[{"productId":"89e00000-0000-4000-9000-000000000041","quantity":{"crates":1,"fraction":0,"bottles":0},"expected":{"full":8000,"half":4000,"quarter":2000,"bottle":500,"size":20,"crate":"89e00000-0000-4000-9000-000000000031","returnable":true,"bottleType":"A return bottle","stock":40},"returnedCrates":0,"returnedBottles":0}]'::jsonb,
   '[]'::jsonb,'[]'::jsonb);
  raise exception 'Business sale succeeded while its gate was OFF' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 if exists(select 1 from public.sales where request_id='89e00000-0000-4000-9000-000000000061') then
  raise exception 'Gate-off attempt left a sale row';
 end if;
end;
$gate_off$;
reset role;

update private.business_sales_gate set enabled=true where singleton;
update private.business_selection_gate set enabled=true where singleton;

do $sale_preflight$
begin
 if not private.business_sale_write_allowed(
   '89e00000-0000-4000-9000-000000000021',
   '89e00000-0000-4000-8000-000000000002'
 ) then
  raise exception 'Business sale helper rejected the active owner or enabled gates';
 end if;
 if not exists(select 1 from public.customers
   where id='89e00000-0000-4000-9000-000000000051'
     and business_id='89e00000-0000-4000-9000-000000000021') then
  raise exception 'Business sale fixture customer is not tenant-linked';
 end if;
end;
$sale_preflight$;

set local role authenticated;
select set_config('request.jwt.claim.sub','89e00000-0000-4000-8000-000000000002',true);
do $owner_a$
declare v jsonb; replayed jsonb; sale_id uuid; business_date date;
begin
 business_date:=(pg_catalog.now() at time zone 'Africa/Lagos')::date;
 v:=public.save_business_sale_v2(
   '89e00000-0000-4000-9000-000000000021',
   '89e00000-0000-4000-9000-000000000061',
   '89e00000-0000-4000-9000-000000000051',
   business_date,3000,'cash',
   '[{"productId":"89e00000-0000-4000-9000-000000000041","quantity":{"crates":1,"fraction":0,"bottles":0},"expected":{"full":8000,"half":4000,"quarter":2000,"bottle":500,"size":20,"crate":"89e00000-0000-4000-9000-000000000031","returnable":true,"bottleType":"A return bottle","stock":40},"returnedCrates":0,"returnedBottles":0}]'::jsonb,
   '[]'::jsonb,'[]'::jsonb);
 sale_id:=(v->>'id')::uuid;
 if v->>'businessId'<>'89e00000-0000-4000-9000-000000000021'
    or v->>'total'<>'8000' or v->>'paid'<>'3000' or v->>'owing'<>'5000' then
  raise exception 'A sale result incorrect: %',v;
 end if;
 replayed:=public.save_business_sale_v2(
   '89e00000-0000-4000-9000-000000000021',
   '89e00000-0000-4000-9000-000000000061',
   '89e00000-0000-4000-9000-000000000051',
   business_date,3000,'cash',
   '[{"productId":"89e00000-0000-4000-9000-000000000041","quantity":{"crates":1,"fraction":0,"bottles":0},"expected":{"full":8000,"half":4000,"quarter":2000,"bottle":500,"size":20,"crate":"89e00000-0000-4000-9000-000000000031","returnable":true,"bottleType":"A return bottle","stock":40},"returnedCrates":0,"returnedBottles":0}]'::jsonb,
   '[]'::jsonb,'[]'::jsonb);
 if (replayed->>'id')::uuid<>sale_id then
  raise exception 'Exact retry created a second sale: %',replayed;
 end if;
 if (select total_bottles from public.stock where product_id='89e00000-0000-4000-9000-000000000041')<>20
    or (select amount from public.money_owed where customer_id='89e00000-0000-4000-9000-000000000051')<>5000
    or (select quantity from public.crate_obligations where customer_id='89e00000-0000-4000-9000-000000000051')<>1
    or (select quantity from public.bottle_obligations where customer_id='89e00000-0000-4000-9000-000000000051')<>20
    or (select count(*) from public.sales where business_id='89e00000-0000-4000-9000-000000000021')<>1
    or (select count(*) from public.stock_movements where business_id='89e00000-0000-4000-9000-000000000021' and movement_type='sale')<>1 then
  raise exception 'Sale retry double-counted stock, debt or empties';
 end if;
 if not exists(
  select 1 from public.sales s
  where s.id=sale_id and s.receipt_business->>'name'='Depot A'
    and s.receipt_customer_name='A Customer'
 ) then
  raise exception 'Receipt snapshot did not capture the correct business/customer';
 end if;
 begin
  perform public.save_business_sale_v2(
   '89e00000-0000-4000-9000-000000000021',
   '89e00000-0000-4000-9000-000000000061',
   '89e00000-0000-4000-9000-000000000051',
   business_date,4000,'cash',
   '[{"productId":"89e00000-0000-4000-9000-000000000041","quantity":{"crates":1,"fraction":0,"bottles":0},"expected":{"full":8000,"half":4000,"quarter":2000,"bottle":500,"size":20,"crate":"89e00000-0000-4000-9000-000000000031","returnable":true,"bottleType":"A return bottle","stock":40},"returnedCrates":0,"returnedBottles":0}]'::jsonb,
   '[]'::jsonb,'[]'::jsonb);
  raise exception 'Changed-payload retry overwrote the sale' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.save_business_sale_v2(
   '89e00000-0000-4000-9000-000000000021',
   '89e00000-0000-4000-9000-000000000062',
   '89e00000-0000-4000-9000-000000000051',
   business_date,16000,'cash',
   '[{"productId":"89e00000-0000-4000-9000-000000000041","quantity":{"crates":2,"fraction":0,"bottles":0},"expected":{"full":8000,"half":4000,"quarter":2000,"bottle":500,"size":20,"crate":"89e00000-0000-4000-9000-000000000031","returnable":true,"bottleType":"A return bottle","stock":20},"returnedCrates":0,"returnedBottles":0}]'::jsonb,
   '[]'::jsonb,'[]'::jsonb);
  raise exception 'Sale oversold inventory' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 if (select count(*) from public.sales where business_id='89e00000-0000-4000-9000-000000000021')<>1 then
  raise exception 'Failed/oversold attempts left a sale row';
 end if;
end;
$owner_a$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','89e00000-0000-4000-8000-000000000003',true);
do $owner_b$
declare v jsonb; business_date date;
begin
 business_date:=(pg_catalog.now() at time zone 'Africa/Lagos')::date;
 begin
  perform public.save_business_sale_v2(
   '89e00000-0000-4000-9000-000000000021',
   '89e00000-0000-4000-9000-000000000071',
   '89e00000-0000-4000-9000-000000000051',
   business_date,3000,'cash',
   '[{"productId":"89e00000-0000-4000-9000-000000000041","quantity":{"crates":1,"fraction":0,"bottles":0},"expected":{"full":8000,"half":4000,"quarter":2000,"bottle":500,"size":20,"crate":"89e00000-0000-4000-9000-000000000031","returnable":true,"bottleType":"A return bottle","stock":20},"returnedCrates":0,"returnedBottles":0}]'::jsonb,
   '[]'::jsonb,'[]'::jsonb);
  raise exception 'B owner wrote A business sale' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 -- The same request UUID is valid in a different tenant: idempotency is
 -- business-scoped rather than a cross-depot collision.
 v:=public.save_business_sale_v2(
   '89e00000-0000-4000-9000-000000000022',
   '89e00000-0000-4000-9000-000000000061',
   '89e00000-0000-4000-9000-000000000052',
   business_date,9000,'transfer',
   '[{"productId":"89e00000-0000-4000-9000-000000000042","quantity":{"crates":1,"fraction":0,"bottles":0},"expected":{"full":9000,"half":4500,"quarter":2250,"bottle":550,"size":20,"crate":"89e00000-0000-4000-9000-000000000032","returnable":true,"bottleType":"B return bottle","stock":40},"returnedCrates":0,"returnedBottles":0}]'::jsonb,
   '[]'::jsonb,'[]'::jsonb);
 if v->>'businessId'<>'89e00000-0000-4000-9000-000000000022' or v->>'total'<>'9000' then
  raise exception 'B sale failed or crossed tenant: %',v;
 end if;
 if (select count(*) from public.sales where business_id='89e00000-0000-4000-9000-000000000021')<>0 then
  raise exception 'B owner can read A sales through RLS';
 end if;
 if (select count(*) from public.sale_items where business_id='89e00000-0000-4000-9000-000000000021')<>0 then
  raise exception 'B owner can read A sale items through RLS';
 end if;
end;
$owner_b$;
reset role;

-- Verify a full crate-and-bottle return is attached to the correct sale and
-- replenishes only the matching depot's empty inventory.
set local role authenticated;
select set_config('request.jwt.claim.sub','89e00000-0000-4000-8000-000000000002',true);
do $returns$
declare v jsonb; business_date date;
begin
 business_date:=(pg_catalog.now() at time zone 'Africa/Lagos')::date;
 v:=public.save_business_sale_v2(
   '89e00000-0000-4000-9000-000000000021',
   '89e00000-0000-4000-9000-000000000081',
   '89e00000-0000-4000-9000-000000000053',
   business_date,8000,'cash',
   '[{"productId":"89e00000-0000-4000-9000-000000000041","quantity":{"crates":1,"fraction":0,"bottles":0},"expected":{"full":8000,"half":4000,"quarter":2000,"bottle":500,"size":20,"crate":"89e00000-0000-4000-9000-000000000031","returnable":true,"bottleType":"A return bottle","stock":20},"returnedCrates":1,"returnedBottles":20}]'::jsonb,
   '[{"crateTypeId":"89e00000-0000-4000-9000-000000000031","quantity":1}]'::jsonb,
   '[{"bottleType":"A return bottle","quantity":20}]'::jsonb
 );
 if v->>'owing'<>'0'
    or (select quantity from public.empty_crate_stock where crate_type_id='89e00000-0000-4000-9000-000000000031')<>1
    or (select quantity from public.empty_bottle_stock where business_id='89e00000-0000-4000-9000-000000000021' and bottle_type='A return bottle')<>20
    or exists(select 1 from public.crate_obligations where customer_id='89e00000-0000-4000-9000-000000000053')
    or exists(select 1 from public.bottle_obligations where customer_id='89e00000-0000-4000-9000-000000000053') then
  raise exception 'Returned crate/bottle stock or obligations are incorrect: %',v;
 end if;
end;
$returns$;
reset role;

-- No other tenant's inventory or balances changed.
do $final$
begin
 if (select total_bottles from public.stock where product_id='89e00000-0000-4000-9000-000000000041')<>0
    or (select total_bottles from public.stock where product_id='89e00000-0000-4000-9000-000000000042')<>20
    or (select amount from public.money_owed where customer_id='89e00000-0000-4000-9000-000000000051')<>5000
    or (select count(*) from public.sales where business_id='89e00000-0000-4000-9000-000000000021')<>2
    or (select count(*) from public.sales where business_id='89e00000-0000-4000-9000-000000000022')<>1 then
  raise exception 'Final tenant sale state is inconsistent';
 end if;
end;
$final$;

rollback;
