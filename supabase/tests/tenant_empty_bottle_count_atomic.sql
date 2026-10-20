-- New-business physical-bottle count acceptance. ALL writes roll back.
-- The owner RPC has NO production permission or enabled rollout by default.
begin;

insert into auth.users(id) values
 ('89a00000-0000-4000-8000-000000000001'),
 ('89a00000-0000-4000-8000-000000000002'),
 ('89a00000-0000-4000-8000-000000000003');
insert into private.shop_owner(user_id)
 values('89a00000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
insert into public.empty_bottle_stock(bottle_type,quantity)
 values('Goldberg bottle',3);

select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate$
declare r record;n integer:=0;
begin
 for r in
  select ns.nspname s,c.relname t,k.conname
  from pg_constraint k join pg_class c on c.oid=k.conrelid
  join pg_namespace ns on ns.oid=c.relnamespace
  join private.legacy_scope_tables() tab
    on tab.schema_name=ns.nspname and tab.table_name=c.relname
  where k.contype='f' and left(k.conname,7)='tenant_'
 loop
  execute format('alter table %I.%I validate constraint %I',
    r.s,r.t,r.conname);
  n:=n+1;
 end loop;
 if n<>31 then raise exception 'Unvalidated tenant FK count %',n;end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

insert into private.businesses(id,status) values
 ('89a00000-0000-4000-9000-000000000011','setup'),
 ('89a00000-0000-4000-9000-000000000012','active');
insert into private.business_memberships(business_id,user_id,status,member_kind)
values
 ('89a00000-0000-4000-9000-000000000011',
  '89a00000-0000-4000-8000-000000000002','active','owner'),
 ('89a00000-0000-4000-9000-000000000012',
  '89a00000-0000-4000-8000-000000000003','active','owner');

-- Bottle inventory must correspond to a configured returnable drink in
-- this exact business. Create controlled admin-only product fixtures.
alter table public.crate_types disable trigger legacy_scope_business_write;
alter table public.products disable trigger legacy_scope_business_write;
insert into public.crate_types(id,business_id,name,empty_family,pocket_count)
values
 ('89a00000-0000-4000-9000-000000000031',
  '89a00000-0000-4000-9000-000000000011','A Goldberg crate','NBL',20),
 ('89a00000-0000-4000-9000-000000000032',
  '89a00000-0000-4000-9000-000000000012','B Goldberg crate','NBL',20);
insert into public.products(
 id,business_id,name,bottles_per_crate,full_crate_price,
 bottles_returnable,bottle_type,crate_type_id
) values
 ('89a00000-0000-4000-9000-000000000041',
  '89a00000-0000-4000-9000-000000000011','A Goldberg',
  20,10000,true,'Goldberg bottle','89a00000-0000-4000-9000-000000000031'),
 ('89a00000-0000-4000-9000-000000000042',
  '89a00000-0000-4000-9000-000000000012','B Goldberg',
  20,12000,true,'Goldberg bottle','89a00000-0000-4000-9000-000000000032');
alter table public.crate_types enable trigger legacy_scope_business_write;
alter table public.products enable trigger legacy_scope_business_write;

-- The new write surface must be unavailable until a distinct approved
-- release explicitly grants EXECUTE and switches the administrative gate.
do $default_off$
begin
 if (select enabled from private.business_bottle_count_gate)
    or has_function_privilege('authenticated',
      'public.count_business_empty_bottles(uuid,uuid,text,integer,integer,date)',
      'EXECUTE')
    or has_function_privilege('anon',
      'public.count_business_empty_bottles(uuid,uuid,text,integer,integer,date)',
      'EXECUTE') then
    raise exception 'A new-business stock writer was publicly enabled';
 end if;
end;
$default_off$;

-- Simulated release permission/activation, only inside this rollback.
grant execute on function public.count_business_empty_bottles(
 uuid,uuid,text,integer,integer,date
) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89a00000-0000-4000-8000-000000000002',true);
do $disabled_gate$
begin
 begin
  perform public.count_business_empty_bottles(
    '89a00000-0000-4000-9000-000000000011',
    '89a00000-0000-4000-9000-000000000101',
    'Goldberg bottle',4,0,'2026-10-17');
  raise exception 'Business counted bottles while release gate off'
    using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$disabled_gate$;
reset role;

update private.business_bottle_count_gate set enabled=true where singleton;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89a00000-0000-4000-8000-000000000002',true);
do $owner_a$
declare a jsonb;repeat jsonb;
begin
 -- A made-up label must NOT create accepted physical bottle stock.
 begin
  perform public.count_business_empty_bottles(
    '89a00000-0000-4000-9000-000000000011',
    '89a00000-0000-4000-9000-000000000110',
    'invented bottle',8,0,'2026-10-17');
  raise exception 'Invented returnable bottle was counted' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 a:=public.count_business_empty_bottles(
    '89a00000-0000-4000-9000-000000000011',
    '89a00000-0000-4000-9000-000000000101',
    'Goldberg bottle',4,0,'2026-10-17');
 if (a->>'previous')::integer<>0 or (a->>'quantity')::integer<>4 then
   raise exception 'A first bottle count incorrect: %',a;
 end if;
 repeat:=public.count_business_empty_bottles(
    '89a00000-0000-4000-9000-000000000011',
    '89a00000-0000-4000-9000-000000000101',
    'Goldberg bottle',4,0,'2026-10-17');
 if repeat is distinct from a then raise exception 'A replay changed original count';end if;
 if (select count(*) from public.empty_bottle_stock
     where bottle_type='Goldberg bottle')<>1
    or (select quantity from public.empty_bottle_stock
      where bottle_type='Goldberg bottle')<>4 then
   raise exception 'A must see only its own Goldberg bottles (4), not legacy stock';
 end if;
end;
$owner_a$;

do $cross_business$
begin
 begin
  perform public.count_business_empty_bottles(
    '89a00000-0000-4000-9000-000000000012',
    '89a00000-0000-4000-9000-000000000201',
    'Goldberg bottle',99,0,'2026-10-17');
  raise exception 'A owner wrote the B business stock'
    using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
  update public.empty_bottle_stock set quantity=1000
    where bottle_type='Goldberg bottle';
  raise exception 'A bypassed the owner-only count RPC'
    using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$cross_business$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89a00000-0000-4000-8000-000000000003',true);
do $owner_b$
declare b jsonb;
begin
 b:=public.count_business_empty_bottles(
    '89a00000-0000-4000-9000-000000000012',
    '89a00000-0000-4000-9000-000000000201',
    'Goldberg bottle',9,0,'2026-10-17');
 if (b->>'previous')::integer<>0 or (b->>'quantity')::integer<>9 then
  raise exception 'B first empty-bottle count wrong: %',b;
 end if;
end;
$owner_b$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89a00000-0000-4000-8000-000000000002',true);
do $stale_and_replay$
declare v jsonb;
begin
 v:=public.count_business_empty_bottles(
   '89a00000-0000-4000-9000-000000000011',
   '89a00000-0000-4000-9000-000000000102',
   'Goldberg bottle',5,4,'2026-10-17');
 if (v->>'previous')::integer<>4 then raise exception 'Expected A previous=4';end if;
 begin
   perform public.count_business_empty_bottles(
     '89a00000-0000-4000-9000-000000000011',
     '89a00000-0000-4000-9000-000000000103',
     'Goldberg bottle',100,4,'2026-10-17');
   raise exception 'Stale empty count overwrote latest balance'
     using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
   perform public.count_business_empty_bottles(
     '89a00000-0000-4000-9000-000000000011',
     '89a00000-0000-4000-9000-000000000102',
     'Goldberg bottle',6,4,'2026-10-17');
   raise exception 'Same request ID accepted changed quantity'
     using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 v:=public.count_business_empty_bottles(
   '89a00000-0000-4000-9000-000000000011',
   '89a00000-0000-4000-9000-000000000101',
   'Goldberg bottle',4,0,'2026-10-17');
 if (v->>'quantity')::integer<>4 then
   raise exception 'Original request replay did not return original value: %',v;
 end if;
end;
$stale_and_replay$;
reset role;

-- A saved request must remain replayable even after the returnable
-- product is reconfigured. Only NEW requests need today's product identity.
savepoint removed_bottle_identity;
alter table public.products disable trigger legacy_scope_business_write;
update public.products
 set bottles_returnable=false,bottle_type=null
 where id='89a00000-0000-4000-9000-000000000041';
alter table public.products enable trigger legacy_scope_business_write;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89a00000-0000-4000-8000-000000000002',true);
do $replay_after_product_change$
declare v jsonb;
begin
 v:=public.count_business_empty_bottles(
   '89a00000-0000-4000-9000-000000000011',
   '89a00000-0000-4000-9000-000000000101',
   'Goldberg bottle',4,0,'2026-10-17');
 if (v->>'quantity')::int<>4 then
  raise exception 'Removed bottle identity broke saved count replay';
 end if;
 begin
  perform public.count_business_empty_bottles(
   '89a00000-0000-4000-9000-000000000011',
   '89a00000-0000-4000-9000-000000000111',
   'Goldberg bottle',5,5,'2026-10-17');
  raise exception 'New count accepted withdrawn bottle identity'
   using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
end;
$replay_after_product_change$;
reset role;
rollback to savepoint removed_bottle_identity;
release savepoint removed_bottle_identity;

do $bottle_totals$
begin
 if (select count(*) from public.empty_bottle_stock
     where bottle_type='Goldberg bottle')<>3
 or (select quantity from public.empty_bottle_stock s
     join private.businesses b on b.id=s.business_id
     where b.legacy_singleton is true and bottle_type='Goldberg bottle')<>3
 or (select quantity from public.empty_bottle_stock where
     business_id='89a00000-0000-4000-9000-000000000011' and bottle_type='Goldberg bottle')<>5
 or (select quantity from public.empty_bottle_stock where
     business_id='89a00000-0000-4000-9000-000000000012' and bottle_type='Goldberg bottle')<>9
 or (select count(*) from private.business_empty_bottle_counts)<>3 then
  raise exception 'Shop counts or immutable event history leaked or changed';
 end if;
end;
$bottle_totals$;

update private.business_memberships set status='disabled'
where business_id='89a00000-0000-4000-9000-000000000012';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89a00000-0000-4000-8000-000000000003',true);
do $revoked$
begin
 begin
  perform public.count_business_empty_bottles(
    '89a00000-0000-4000-9000-000000000012',
    '89a00000-0000-4000-9000-000000000201',
    'Goldberg bottle',9,0,'2026-10-17');
  raise exception 'Revoked owner replayed stock count'
    using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 if exists(select 1 from public.empty_bottle_stock) then
  raise exception 'Revoked owner can still read stock';
 end if;
end;
$revoked$;
reset role;

rollback;
