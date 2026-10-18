-- Disposable acceptance for one-time owned drink/empty-crate/empty-bottle
-- physical counts. All data, grants and setup gates are rolled back.
begin;
insert into auth.users(id) values
 ('89a00000-0000-4000-8000-000000000001'),
 ('89a00000-0000-4000-8000-000000000002'),
 ('89a00000-0000-4000-8000-000000000003'),
 ('89a00000-0000-4000-8000-000000000004');
insert into private.shop_owner(user_id)
 values('89a00000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate$
declare r record;n int:=0;
begin
 for r in select ns.nspname s,c.relname t,k.conname
  from pg_constraint k join pg_class c on c.oid=k.conrelid
  join pg_namespace ns on ns.oid=c.relnamespace
  join private.legacy_scope_tables() tab
    on tab.schema_name=ns.nspname and tab.table_name=c.relname
  where k.contype='f' and left(k.conname,7)='tenant_'
 loop
  execute format('alter table %I.%I validate constraint %I',r.s,r.t,r.conname);
  n:=n+1;
 end loop;
 if n<>31 then raise exception 'Missing 31 tenant FKs: %',n;end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());
insert into private.businesses(id,status) values
 ('89a00000-0000-4000-9000-000000000021','setup'),
 ('89a00000-0000-4000-9000-000000000022','setup');
insert into private.business_memberships(business_id,user_id,status,member_kind)
values
 ('89a00000-0000-4000-9000-000000000021',
  '89a00000-0000-4000-8000-000000000002','active','owner'),
 ('89a00000-0000-4000-9000-000000000022',
  '89a00000-0000-4000-8000-000000000003','active','owner');

-- Administrator-only fixtures, restored before any authenticated calls.
alter table public.crate_types disable trigger legacy_scope_business_write;
alter table public.products disable trigger legacy_scope_business_write;
insert into public.crate_types(
 id,business_id,name,empty_family,pocket_count
) values
 ('89a00000-0000-4000-9000-000000000031',
  '89a00000-0000-4000-9000-000000000021',
  'A NBL shared 20 crate','NBL',20),
 ('89a00000-0000-4000-9000-000000000032',
  '89a00000-0000-4000-9000-000000000022',
  'B NBL exact 20 crate','NBL',20);
insert into public.products(
 id,business_id,name,bottles_per_crate,full_crate_price,
 bottles_returnable,bottle_type,crate_type_id
) values
 ('89a00000-0000-4000-9000-000000000041',
  '89a00000-0000-4000-9000-000000000021',
  'A Goldberg',20,10000,true,'Goldberg return bottle',
  '89a00000-0000-4000-9000-000000000031'),
 ('89a00000-0000-4000-9000-000000000042',
  '89a00000-0000-4000-9000-000000000022',
  'B Goldberg',20,12000,true,'Goldberg return bottle',
  '89a00000-0000-4000-9000-000000000032');
alter table public.crate_types enable trigger legacy_scope_business_write;
alter table public.products enable trigger legacy_scope_business_write;

do $default_off$
begin
 if (select enabled from private.business_physical_opening_gate)
 or has_function_privilege('authenticated',
  'public.record_business_physical_opening(uuid,uuid,text,text,integer,integer,integer,date)',
  'EXECUTE')
 or has_function_privilege('anon',
  'public.record_business_physical_opening(uuid,uuid,text,text,integer,integer,integer,date)',
  'EXECUTE')
 or has_function_privilege('authenticated',
  'public.preview_business_opening_count_progress(uuid)','EXECUTE')
 or has_function_privilege('anon',
  'public.preview_business_opening_count_progress(uuid)','EXECUTE') then
  raise exception 'Physical opening unexpectedly granted or active';
 end if;
end;
$default_off$;
grant execute on function public.record_business_physical_opening(
 uuid,uuid,text,text,integer,integer,integer,date
) to authenticated;
grant execute on function public.preview_business_opening_count_progress(uuid) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89a00000-0000-4000-8000-000000000002',true);
do $disabled$
begin
 begin
  perform public.record_business_physical_opening(
    '89a00000-0000-4000-9000-000000000021',
    '89a00000-0000-4000-9000-000000000061',
    'drink','89a00000-0000-4000-9000-000000000041',
    3,2,20,'2026-10-18');
  raise exception 'Physical opening bypassed default gate' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$disabled$;
reset role;
update private.business_physical_opening_gate set enabled=true where singleton;
update private.business_product_stock_count_gate set enabled=true where singleton;
update private.business_crate_count_gate set enabled=true where singleton;
update private.business_bottle_count_gate set enabled=true where singleton;

-- Deliberately fail the LAST step for a different bottle request.
-- The underlying physical stock and its stock-count audit must roll back.
create function pg_temp.reject_physical_opening()
returns trigger language plpgsql as $reject$
begin
 if new.request_id='89a00000-0000-4000-9000-000000000069'::uuid then
  raise exception 'Injected final physical opening journal failure'
    using errcode='22023';
 end if;
 return new;
end;
$reject$;
create trigger disposable_opening_journal_failure
 after insert on private.business_physical_opening_lines
 for each row execute function pg_temp.reject_physical_opening();

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89a00000-0000-4000-8000-000000000002',true);
do $owner_a$
declare
 drink jsonb;
 crate jsonb;
 bottles jsonb;
 retry jsonb;
begin
 drink:=public.record_business_physical_opening(
  '89a00000-0000-4000-9000-000000000021',
  '89a00000-0000-4000-9000-000000000061',
  'drink','89a00000-0000-4000-9000-000000000041',
  3,2,20,'2026-10-18');
 if (drink->'count'->>'total')::integer<>62 then
  raise exception 'A full drink opening count missing 62 bottles: %',drink;
 end if;
 retry:=public.record_business_physical_opening(
  '89a00000-0000-4000-9000-000000000021',
  '89a00000-0000-4000-9000-000000000061',
  'drink','89a00000-0000-4000-9000-000000000041',
  3,2,20,'2026-10-18');
 if retry is distinct from drink then
  raise exception 'Original physical opening replay changed';
 end if;
 crate:=public.record_business_physical_opening(
  '89a00000-0000-4000-9000-000000000021',
  '89a00000-0000-4000-9000-000000000062',
  'crate','89a00000-0000-4000-9000-000000000031',
  14,0,0,'2026-10-18');
 if (crate->'count'->>'quantity')::integer<>14 then
  raise exception 'A empty crates not counted: %',crate;
 end if;
 bottles:=public.record_business_physical_opening(
  '89a00000-0000-4000-9000-000000000021',
  '89a00000-0000-4000-9000-000000000063',
  'bottle','Goldberg return bottle',
  85,0,0,'2026-10-18');
 if (bottles->'count'->>'quantity')::integer<>85 then
  raise exception 'A owned bottles not counted: %',bottles;
 end if;
 if (select total_bottles from public.stock)<>62
  or (select quantity from public.empty_crate_stock)<>14
  or (select quantity from public.empty_bottle_stock)<>85 then
  raise exception 'A physical inventory not saved independently';
 end if;
 begin
  perform public.record_business_physical_opening(
   '89a00000-0000-4000-9000-000000000021',
   '89a00000-0000-4000-9000-000000000064',
   'drink','89a00000-0000-4000-9000-000000000041',
   3,2,20,'2026-10-18');
  raise exception 'Second physical opening duplicate recorded' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.record_business_physical_opening(
   '89a00000-0000-4000-9000-000000000021',
   '89a00000-0000-4000-9000-000000000061',
   'crate','89a00000-0000-4000-9000-000000000031',
   14,0,0,'2026-10-18');
  raise exception 'Drink opening UUID reused for crates' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.record_business_physical_opening(
   '89a00000-0000-4000-9000-000000000021',
   '89a00000-0000-4000-9000-000000000065',
   'crate','89a00000-0000-4000-9000-000000000032',
   1,0,0,'2026-10-18');
  raise exception 'A counted B physical crate' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.record_business_physical_opening(
   '89a00000-0000-4000-9000-000000000021',
   '89a00000-0000-4000-9000-000000000066',
   'bottle','B unrelated return bottle',
   3,0,0,'2026-10-18');
  raise exception 'A counted unconfigured bottle type' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.record_business_physical_opening(
   '89a00000-0000-4000-9000-000000000021',
   '89a00000-0000-4000-9000-000000000067',
   'drink','89a00000-0000-4000-9000-000000000042',
   1,0,20,'2026-10-18');
  raise exception 'A counted B product' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 -- Same real bottle type already counted. Force final-INSERT failure on a
 -- zero-qty new TYPE in B below; ensure there is no physical B row.
 begin
  update public.stock set total_bottles=10;
  raise exception 'Direct stock rewrite unexpectedly allowed' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$owner_a$;
reset role;

-- B uses the SAME request UUID as A, independently stocked.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89a00000-0000-4000-8000-000000000003',true);
do $owner_b$
declare drink jsonb;crate jsonb;
begin
 drink:=public.record_business_physical_opening(
  '89a00000-0000-4000-9000-000000000022',
  '89a00000-0000-4000-9000-000000000061',
  'drink','89a00000-0000-4000-9000-000000000042',
  1,1,20,'2026-10-18');
 if (drink->'count'->>'total')::integer<>21 then
  raise exception 'B same request UUID did not save independent 21';
 end if;
 crate:=public.record_business_physical_opening(
  '89a00000-0000-4000-9000-000000000022',
  '89a00000-0000-4000-9000-000000000062',
  'crate','89a00000-0000-4000-9000-000000000032',
  0,0,0,'2026-10-18');
 if (crate->'count'->>'quantity')::integer<>0 then
  raise exception 'B explicit zero opening count lost';
 end if;
 begin
  perform public.record_business_physical_opening(
   '89a00000-0000-4000-9000-000000000022',
   '89a00000-0000-4000-9000-000000000068',
   'crate','89a00000-0000-4000-9000-000000000032',
   0,0,0,'2026-10-18');
  raise exception 'Zero physical count accepted duplicate opening' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 -- Simulated journal error rolls back B empty-bottle stock and its
 -- private stock-count request; no partial side-effect on failure.
 begin
  perform public.record_business_physical_opening(
   '89a00000-0000-4000-9000-000000000022',
   '89a00000-0000-4000-9000-000000000069',
   'bottle','Goldberg return bottle',
   10,0,0,'2026-10-18');
  raise exception 'Failed physical journal committed bottle stock' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 if exists(select 1 from public.empty_bottle_stock) then
  raise exception 'Injected journal failure left B partial bottle stock';
 end if;
end;
$owner_b$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89a00000-0000-4000-8000-000000000003',true);
do $owner_b_zero_progress$
declare v jsonb;
begin
 v:=public.preview_business_opening_count_progress(
   '89a00000-0000-4000-9000-000000000022');
 if v->>'count'<>'2' or jsonb_array_length(v->'lines')<>2
  or not exists(
    select 1 from jsonb_array_elements(v->'lines') e
    where e->>'kind'='crate'
      and e->>'resource'='89a00000-0000-4000-9000-000000000032'
  ) then
  raise exception 'B explicit zero opening not recognized: %',v;
 end if;
end;
$owner_b_zero_progress$;
reset role;

-- After final activation, the original stock-count response remains
-- recoverable, while new physical opening events are forbidden.
update private.businesses set status='active'
 where id='89a00000-0000-4000-9000-000000000022';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89a00000-0000-4000-8000-000000000003',true);
do $activated_physical_replay_only$
declare v jsonb;
begin
 v:=public.record_business_physical_opening(
   '89a00000-0000-4000-9000-000000000022',
   '89a00000-0000-4000-9000-000000000061',
   'drink','89a00000-0000-4000-9000-000000000042',
   1,1,20,'2026-10-18');
 if (v->'count'->>'total')::integer<>21 then
  raise exception 'Saved B drink opening not recoverable after activation';
 end if;
 begin
  perform public.record_business_physical_opening(
   '89a00000-0000-4000-9000-000000000022',
   '89a00000-0000-4000-9000-000000000070',
   'bottle','Goldberg return bottle',10,0,0,'2026-10-18');
  raise exception 'ACTIVE business accepted new bottle opening' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$activated_physical_replay_only$;
reset role;

-- Each owner's progress must show only their exact immutable markers,
-- with explicit zero-counts still recognized as completed work.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89a00000-0000-4000-8000-000000000002',true);
do $owner_a_progress$
declare v jsonb;
begin
 v:=public.preview_business_opening_count_progress(
   '89a00000-0000-4000-9000-000000000021');
 if v->>'count'<>'3' or v->>'truncated'<>'false'
  or v->>'canActivate'<>'false'
  or jsonb_array_length(v->'lines')<>3
  or not exists(
    select 1 from jsonb_array_elements(v->'lines') e
    where e->>'kind'='crate'
      and e->>'resource'='89a00000-0000-4000-9000-000000000031'
  ) then
  raise exception 'A progress omitted opening item: %',v;
 end if;
 begin
  perform public.preview_business_opening_count_progress(
    '89a00000-0000-4000-9000-000000000022');
  raise exception 'A saw B private opening progress' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$owner_a_progress$;
reset role;


do $verify$
begin
 -- Private audit is inspected only as the disposable TEST ADMIN, not as
 -- an ordinary owner. Owners must never have private audit SELECT grants.
 if exists(select 1 from private.business_empty_bottle_counts
           where business_id='89a00000-0000-4000-9000-000000000022')
 or exists(select 1 from private.business_physical_opening_lines
           where request_id='89a00000-0000-4000-9000-000000000069') then
  raise exception 'Final physical journal failure left a private audit';
 end if;
 if (select count(*) from private.business_physical_opening_lines)<>5
 or (select count(*) from private.business_product_stock_counts)<>2
 or (select count(*) from private.business_empty_crate_counts)<>2
 or (select count(*) from private.business_empty_bottle_counts)<>1
 or (select count(*) from public.stock)<>2
 or (select sum(total_bottles) from public.stock)<>83
 or (select count(*) from public.empty_crate_stock)<>2
 or (select sum(quantity) from public.empty_crate_stock)<>14
 or (select count(*) from public.empty_bottle_stock)<>1
 or (select quantity from public.empty_bottle_stock)<>85
 or exists(select 1 from public.sales)
 or exists(select 1 from public.deposits)
 or exists(select 1 from public.money_owed) then
  raise exception 'A/B physical counts, audit or money isolation inconsistent';
 end if;
end;
$verify$;

-- A revoked owner cannot replay even a previously saved opening.
update private.business_memberships set status='disabled'
 where business_id='89a00000-0000-4000-9000-000000000022';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89a00000-0000-4000-8000-000000000003',true);
do $revoked$
begin
 begin
  perform public.record_business_physical_opening(
   '89a00000-0000-4000-9000-000000000022',
   '89a00000-0000-4000-9000-000000000061',
   'drink','89a00000-0000-4000-9000-000000000042',
   1,1,20,'2026-10-18');
  raise exception 'Revoked owner replayed B stock opening' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 if exists(select 1 from public.stock)
  or exists(select 1 from public.empty_crate_stock) then
  raise exception 'Revoked owner can still read physical stock';
 end if;
end;
$revoked$;
reset role;
rollback;
