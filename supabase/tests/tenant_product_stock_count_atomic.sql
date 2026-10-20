-- Rollback-only contract for exact per-business drink stock counts.
-- No new-owner product enrollment or financial checkout permissions are
-- enabled outside this disposable test transaction.
begin;

insert into auth.users(id) values
 ('89e00000-0000-4000-8000-000000000001'),
 ('89e00000-0000-4000-8000-000000000002'),
 ('89e00000-0000-4000-8000-000000000003');
insert into private.shop_owner(user_id)
 values('89e00000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
-- The master drink is global, but each shop's product/price/stock is owned
-- independently. Link the same identity to THREE distinct shop products.
insert into public.product_catalogue(id,name,manufacturer)
values('89e00000-0000-4000-9000-000000000090','Shared Goldberg test identity','NB');
insert into public.crate_types(id,name,empty_family,pocket_count)
 values('89e00000-0000-4000-9000-000000000010','Legacy crate','NB',12);
insert into public.products(id,name,bottles_per_crate,full_crate_price,
  bottles_returnable,crate_type_id,catalogue_product_id)
 values('89e00000-0000-4000-9000-000000000011','Legacy drink',12,10000,
   false,'89e00000-0000-4000-9000-000000000010','89e00000-0000-4000-9000-000000000090');
insert into public.stock(product_id,total_bottles)
 values('89e00000-0000-4000-9000-000000000011',8);

select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate$
declare r record; n integer:=0;
begin
 for r in
  select ns.nspname s,c.relname t,k.conname
  from pg_constraint k
  join pg_class c on c.oid=k.conrelid
  join pg_namespace ns on ns.oid=c.relnamespace
  join private.legacy_scope_tables() tab
    on tab.schema_name=ns.nspname and tab.table_name=c.relname
  where k.contype='f' and left(k.conname,7)='tenant_'
 loop
  execute format('alter table %I.%I validate constraint %I',
    r.s,r.t,r.conname);
  n:=n+1;
 end loop;
 if n<>31 then raise exception 'Expected 31 tenant FK checks, got %',n;end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

insert into private.businesses(id,status) values
 ('89e00000-0000-4000-9000-000000000021','setup'),
 ('89e00000-0000-4000-9000-000000000022','active');
insert into private.business_memberships(
 business_id,user_id,status,member_kind
) values
 ('89e00000-0000-4000-9000-000000000021',
  '89e00000-0000-4000-8000-000000000002','active','owner'),
 ('89e00000-0000-4000-9000-000000000022',
  '89e00000-0000-4000-8000-000000000003','active','owner');

-- New-business crate/product enrollment is not implemented yet. Setup
-- fixtures are admin-only, with the scope triggers immediately restored.
alter table public.crate_types disable trigger legacy_scope_business_write;
alter table public.products disable trigger legacy_scope_business_write;
insert into public.crate_types(id,name,empty_family,pocket_count,business_id)
 values
 ('89e00000-0000-4000-9000-000000000031','A crate','NB',12,
  '89e00000-0000-4000-9000-000000000021'),
 ('89e00000-0000-4000-9000-000000000032','B crate','NB',12,
  '89e00000-0000-4000-9000-000000000022');
insert into public.products(
 id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id,business_id,catalogue_product_id
) values
 ('89e00000-0000-4000-9000-000000000041','Goldberg A',12,10000,false,
  '89e00000-0000-4000-9000-000000000031',
  '89e00000-0000-4000-9000-000000000021','89e00000-0000-4000-9000-000000000090'),
 ('89e00000-0000-4000-9000-000000000042','Goldberg B',12,10000,false,
  '89e00000-0000-4000-9000-000000000032',
  '89e00000-0000-4000-9000-000000000022','89e00000-0000-4000-9000-000000000090');
-- The same master ID must NOT stop different shops from stocking Goldberg,
-- but it must reject a second configured copy within the SAME shop.
do $assortment_identity$
begin
 if (select count(*) from public.products
     where catalogue_product_id='89e00000-0000-4000-9000-000000000090')<>3
    or (select count(distinct business_id) from public.products
     where catalogue_product_id='89e00000-0000-4000-9000-000000000090')<>3 then
   raise exception 'One master drink identity cannot serve three businesses';
 end if;
 begin
   insert into public.products(
     id,name,bottles_per_crate,full_crate_price,bottles_returnable,
     crate_type_id,business_id,catalogue_product_id
   ) values (
     '89e00000-0000-4000-9000-000000000043',
     'Duplicate A Goldberg',12,9000,false,
     '89e00000-0000-4000-9000-000000000031',
     '89e00000-0000-4000-9000-000000000021','89e00000-0000-4000-9000-000000000090'
   );
   raise exception 'A configured the same master drink twice'
     using errcode='PT001';
 exception when unique_violation then null;
 end;
end;
$assortment_identity$;
alter table public.products enable trigger legacy_scope_business_write;
alter table public.crate_types enable trigger legacy_scope_business_write;

do $count_gate_default$
begin
 if (select enabled from private.business_product_stock_count_gate)
 or has_function_privilege('authenticated',
  'public.count_business_product_stock(uuid,uuid,uuid,numeric,numeric,integer,integer,date)',
  'EXECUTE')
 or has_function_privilege('anon',
  'public.count_business_product_stock(uuid,uuid,uuid,numeric,numeric,integer,integer,date)',
  'EXECUTE') then
  raise exception 'New business drink stock count was publicly activated';
 end if;
end;
$count_gate_default$;

grant execute on function public.count_business_product_stock(
 uuid,uuid,uuid,numeric,numeric,integer,integer,date
) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89e00000-0000-4000-8000-000000000002',true);
do $disabled$
begin
 begin
  perform public.count_business_product_stock(
   '89e00000-0000-4000-9000-000000000021',
   '89e00000-0000-4000-9000-000000000101',
   '89e00000-0000-4000-9000-000000000041',
   2,3,0,12,'2026-10-18');
  raise exception 'Stock count bypassed rollout gate' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$disabled$;
reset role;
update private.business_product_stock_count_gate
 set enabled=true where singleton;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89e00000-0000-4000-8000-000000000002',true);
do $owner_a$
declare a jsonb; original jsonb;
begin
 a:=public.count_business_product_stock(
  '89e00000-0000-4000-9000-000000000021',
  '89e00000-0000-4000-9000-000000000101',
  '89e00000-0000-4000-9000-000000000041',
  2,3,0,12,'2026-10-18');
 if (a->>'previous')::int<>0 or (a->>'total')::int<>27 then
  raise exception 'A counted expected 27 bottles: %',a;
 end if;
 original:=public.count_business_product_stock(
  '89e00000-0000-4000-9000-000000000021',
  '89e00000-0000-4000-9000-000000000101',
  '89e00000-0000-4000-9000-000000000041',
  2,3,0,12,'2026-10-18');
 if original is distinct from a then raise exception 'Same stock count replay drifted';end if;
 if (select count(*) from public.stock)<>1
    or (select total_bottles from public.stock)<>27 then
  raise exception 'A must only see its own 27 Goldberg bottles';
 end if;
 begin
  perform public.count_business_product_stock(
   '89e00000-0000-4000-9000-000000000022',
   '89e00000-0000-4000-9000-000000000101',
   '89e00000-0000-4000-9000-000000000042',
   1,1,0,12,'2026-10-18');
  raise exception 'A counted B stock' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
  perform public.count_business_product_stock(
   '89e00000-0000-4000-9000-000000000021',
   '89e00000-0000-4000-9000-000000000105',
   '89e00000-0000-4000-9000-000000000042',
   1,1,0,12,'2026-10-18');
  raise exception 'A used foreign product identity' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  update public.stock set total_bottles=999
   where product_id='89e00000-0000-4000-9000-000000000041';
  raise exception 'Direct stock updates bypassed count-only RPC'
   using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$owner_a$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89e00000-0000-4000-8000-000000000003',true);
do $owner_b$
declare b jsonb;
begin
 b:=public.count_business_product_stock(
  '89e00000-0000-4000-9000-000000000022',
  '89e00000-0000-4000-9000-000000000101',
  '89e00000-0000-4000-9000-000000000042',
  1,1,0,12,'2026-10-18');
 if (b->>'previous')::int<>0 or (b->>'total')::int<>13 then
  raise exception 'B expected 13 bottles: %',b;
 end if;
end;
$owner_b$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89e00000-0000-4000-8000-000000000002',true);
do $stale_and_reused$
declare x jsonb;
begin
 x:=public.count_business_product_stock(
  '89e00000-0000-4000-9000-000000000021',
  '89e00000-0000-4000-9000-000000000102',
  '89e00000-0000-4000-9000-000000000041',
  3,1,27,12,'2026-10-18');
 if (x->>'previous')::int<>27 or (x->>'total')::int<>37 then
  raise exception 'A updated physical stock to 37 incorrectly: %',x;
 end if;
 begin
  perform public.count_business_product_stock(
   '89e00000-0000-4000-9000-000000000021',
   '89e00000-0000-4000-9000-000000000103',
   '89e00000-0000-4000-9000-000000000041',
   4,1,27,12,'2026-10-18');
  raise exception 'A overwrote a newer count using stale 27'
    using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.count_business_product_stock(
   '89e00000-0000-4000-9000-000000000021',
   '89e00000-0000-4000-9000-000000000102',
   '89e00000-0000-4000-9000-000000000041',
   3,2,27,12,'2026-10-18');
  raise exception 'A reused request ID with modified loose bottles'
   using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.count_business_product_stock(
   '89e00000-0000-4000-9000-000000000021',
   '89e00000-0000-4000-9000-000000000105',
   '89e00000-0000-4000-9000-000000000041',
   2,12,37,12,'2026-10-18');
  raise exception 'A accepted 12 loose bottles in a 12-bottle crate'
   using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 x:=public.count_business_product_stock(
  '89e00000-0000-4000-9000-000000000021',
  '89e00000-0000-4000-9000-000000000101',
  '89e00000-0000-4000-9000-000000000041',
  2,3,0,12,'2026-10-18');
 if (x->>'total')::int<>27 then
  raise exception 'Original replay must return original 27, not newest stock';
 end if;
end;
$stale_and_reused$;
reset role;

do $verify_cross_business_counts$
begin
 if (select count(*) from public.stock)<>3
  or (select total_bottles from public.stock
      where product_id='89e00000-0000-4000-9000-000000000011')<>8
  or (select total_bottles from public.stock
      where product_id='89e00000-0000-4000-9000-000000000041')<>37
  or (select total_bottles from public.stock
      where product_id='89e00000-0000-4000-9000-000000000042')<>13
  or (select count(*) from private.business_product_stock_counts)<>3 then
    raise exception 'Legacy/A/B independent stock quantities or audit damaged';
 end if;
end;
$verify_cross_business_counts$;

-- A successful stock count can be retried after drink packaging changed.
-- Replaying the immutable old request must win over CURRENT pack metadata,
-- while a fresh count using stale pack details must fail.
savepoint replay_after_stock_metadata_change;
alter table public.crate_types disable trigger legacy_scope_business_write;
insert into public.crate_types(id,name,empty_family,pocket_count,business_id)
 values('89e00000-0000-4000-9000-000000000034','A replacement crate','NB',13,
 '89e00000-0000-4000-9000-000000000021');
alter table public.crate_types enable trigger legacy_scope_business_write;
alter table public.products disable trigger legacy_scope_business_write;
update public.products set bottles_per_crate=13,
 crate_type_id='89e00000-0000-4000-9000-000000000034'
 where id='89e00000-0000-4000-9000-000000000041';
alter table public.products enable trigger legacy_scope_business_write;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89e00000-0000-4000-8000-000000000002',true);
do $retry_after_pack_change$
declare v jsonb;
begin
 v:=public.count_business_product_stock(
  '89e00000-0000-4000-9000-000000000021',
  '89e00000-0000-4000-9000-000000000101',
  '89e00000-0000-4000-9000-000000000041',
  2,3,0,12,'2026-10-18');
 if (v->>'total')::int<>27 then
  raise exception 'Old stock count did not replay after pack change: %',v;
 end if;
 begin
  perform public.count_business_product_stock(
   '89e00000-0000-4000-9000-000000000021',
   '89e00000-0000-4000-9000-000000000111',
   '89e00000-0000-4000-9000-000000000041',
   2,3,37,12,'2026-10-18');
  raise exception 'New count accepted obsolete pack size' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
end;
$retry_after_pack_change$;
reset role;
rollback to savepoint replay_after_stock_metadata_change;
release savepoint replay_after_stock_metadata_change;

update private.business_memberships set status='disabled'
 where business_id='89e00000-0000-4000-9000-000000000022';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89e00000-0000-4000-8000-000000000003',true);
do $revoked$
begin
 begin
  perform public.count_business_product_stock(
   '89e00000-0000-4000-9000-000000000022',
   '89e00000-0000-4000-9000-000000000101',
   '89e00000-0000-4000-9000-000000000042',
   1,1,0,12,'2026-10-18');
  raise exception 'Revoked owner replayed stock count'
   using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 if exists(select 1 from public.stock) then
  raise exception 'Revoked owner directly read shop stock rows';
 end if;
end;
$revoked$;
reset role;

rollback;
