-- Owner-only opening preview in a disposable two-depot PostgreSQL fixture.
-- The checklist is deliberately NOT a business activation capability.
begin;
insert into auth.users(id) values
 ('89b00000-0000-4000-8000-000000000001'),
 ('89b00000-0000-4000-8000-000000000002'),
 ('89b00000-0000-4000-8000-000000000003'),
 ('89b00000-0000-4000-8000-000000000004');
insert into private.shop_owner(user_id)
 values('89b00000-0000-4000-8000-000000000001');
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
 if n<>31 then raise exception 'Tenant key count drift: %',n;end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());
insert into private.businesses(id,status) values
 ('89b00000-0000-4000-9000-000000000021','setup'),
 ('89b00000-0000-4000-9000-000000000022','setup');
insert into private.business_memberships(business_id,user_id,status,member_kind)
values
 ('89b00000-0000-4000-9000-000000000021',
  '89b00000-0000-4000-8000-000000000002','active','owner'),
 ('89b00000-0000-4000-9000-000000000022',
  '89b00000-0000-4000-8000-000000000003','active','owner');
insert into public.business_profiles(business_id,name,address,phone)
 values('89b00000-0000-4000-9000-000000000021',
        'Sample Depot A','Yaba','08001234567');
alter table public.crate_types disable trigger legacy_scope_business_write;
alter table public.products disable trigger legacy_scope_business_write;
alter table public.customers disable trigger legacy_scope_business_write;
insert into public.crate_types(id,business_id,name,pocket_count,empty_family)
 values
 ('89b00000-0000-4000-9000-000000000031',
  '89b00000-0000-4000-9000-000000000021','A NBL 20',20,'NBL'),
 ('89b00000-0000-4000-9000-000000000032',
  '89b00000-0000-4000-9000-000000000022','B NBL 20',20,'NBL');
insert into public.products(id,business_id,name,bottles_per_crate,
 full_crate_price,crate_type_id,bottles_returnable,bottle_type)
 values
 ('89b00000-0000-4000-9000-000000000041',
  '89b00000-0000-4000-9000-000000000021','A Goldberg',
  20,10000,'89b00000-0000-4000-9000-000000000031',true,'Goldberg bottle'),
 ('89b00000-0000-4000-9000-000000000042',
  '89b00000-0000-4000-9000-000000000022','B Goldberg',
  20,11000,'89b00000-0000-4000-9000-000000000032',true,'Goldberg bottle');
insert into public.customers(id,business_id,name,phone) values
 ('89b00000-0000-4000-9000-000000000051',
  '89b00000-0000-4000-9000-000000000021','A debtor','08001234568'),
 ('89b00000-0000-4000-9000-000000000052',
  '89b00000-0000-4000-9000-000000000021','A no previous balance','08001234569');
alter table public.crate_types enable trigger legacy_scope_business_write;
alter table public.products enable trigger legacy_scope_business_write;
alter table public.customers enable trigger legacy_scope_business_write;
do $default_off$
begin
 if (select enabled from private.business_opening_readiness_gate)
 or has_function_privilege('authenticated',
  'public.preview_business_opening_readiness(uuid)','EXECUTE')
 or has_function_privilege('anon',
  'public.preview_business_opening_readiness(uuid)','EXECUTE') then
  raise exception 'Readiness preview not disabled by default';
 end if;
end;
$default_off$;

grant execute on function public.preview_business_opening_readiness(uuid)
 to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89b00000-0000-4000-8000-000000000002',true);
do $default_gate$
begin
 begin
  perform public.preview_business_opening_readiness(
    '89b00000-0000-4000-9000-000000000021');
  raise exception 'Readiness preview bypassed default OFF gate' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$default_gate$;
reset role;
update private.business_opening_readiness_gate set enabled=true where singleton;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89b00000-0000-4000-8000-000000000002',true);
do $initial_preview$
declare v jsonb;
begin
 v:=public.preview_business_opening_readiness(
  '89b00000-0000-4000-9000-000000000021');
 if v->>'technicalChecklistComplete'<>'false'
  or v->>'canActivate'<>'false'
  or v->'physicalOpening'->>'missingDrinks'<>'1'
  or v->'physicalOpening'->>'missingCrates'<>'1'
  or v->'physicalOpening'->>'missingBottleTypes'<>'1'
  or pg_catalog.jsonb_array_length(v->'physicalOpening'->'missingDrinkIds')<>1
  or v->'configured'->>'activeCustomers'<>'2'
  or v->'customerOpening'->>'customersWithoutOpening'<>'2'
  then
  raise exception 'Readiness reported incomplete depot as ready: %',v;
 end if;
 begin
  perform public.preview_business_opening_readiness(
   '89b00000-0000-4000-9000-000000000022');
  raise exception 'A owner read B readiness' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$initial_preview$;
reset role;

update private.business_physical_opening_gate set enabled=true where singleton;
update private.business_product_stock_count_gate set enabled=true where singleton;
update private.business_crate_count_gate set enabled=true where singleton;
update private.business_bottle_count_gate set enabled=true where singleton;
update private.business_customer_opening_gate set enabled=true where singleton;
grant execute on function public.record_business_physical_opening(
 uuid,uuid,text,text,integer,integer,integer,date) to authenticated;
grant execute on function public.record_business_customer_opening(
 uuid,uuid,uuid,integer,integer,date,text,jsonb,jsonb) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89b00000-0000-4000-8000-000000000002',true);
select public.record_business_physical_opening(
 '89b00000-0000-4000-9000-000000000021',
 '89b00000-0000-4000-9000-000000000061',
 'drink','89b00000-0000-4000-9000-000000000041',
 1,4,20,'2026-10-18');
select public.record_business_physical_opening(
 '89b00000-0000-4000-9000-000000000021',
 '89b00000-0000-4000-9000-000000000062',
 'crate','89b00000-0000-4000-9000-000000000031',
 0,0,0,'2026-10-18');
select public.record_business_physical_opening(
 '89b00000-0000-4000-9000-000000000021',
 '89b00000-0000-4000-9000-000000000063',
 'bottle','Goldberg bottle',0,0,0,'2026-10-18');
select public.record_business_customer_opening(
 '89b00000-0000-4000-9000-000000000021',
 '89b00000-0000-4000-9000-000000000064',
 '89b00000-0000-4000-9000-000000000051',
 45000,10000,'2026-10-18','Existing opening',
 '[{"type":"89b00000-0000-4000-9000-000000000031","quantity":2}]'::jsonb,
 '[{"type":"Goldberg bottle","quantity":7}]'::jsonb);

do $review_not_activation$
declare v jsonb;
begin
 v:=public.preview_business_opening_readiness(
  '89b00000-0000-4000-9000-000000000021');
 if v->>'technicalChecklistComplete'<>'true'
   or v->>'canActivate'<>'false'
   or v->>'customerHistoryAttestationRequired'<>'true'
   or v->'physicalOpening'->>'missingDrinks'<>'0'
   or v->'physicalOpening'->>'missingCrates'<>'0'
   or v->'physicalOpening'->>'missingBottleTypes'<>'0'
   or v->'customerOpening'->>'historicalDebtNaira'<>'45000'
   or v->'customerOpening'->>'refundableDepositsHeldNaira'<>'10000'
   or v->'customerOpening'->>'customersWithoutOpening'<>'1'
   or v->'customerOpening'->>'customerCratesOwed'<>'2'
   or v->'customerOpening'->>'customerBottlesOwed'<>'7'
   then
   raise exception 'Technically reviewable sample wrong or auto-activated: %',v;
 end if;
end;
$review_not_activation$;
reset role;

-- Even an admin fixture can create a drifted balance to simulate
-- data corruption; readiness must show that a financial reconciliation is
-- required. This check is read-only and NEVER repairs accounts silently.
savepoint corrupted_money;
alter table public.money_owed disable trigger legacy_scope_business_write;
update public.money_owed set amount=48000
 where customer_id='89b00000-0000-4000-9000-000000000051';
alter table public.money_owed enable trigger legacy_scope_business_write;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89b00000-0000-4000-8000-000000000002',true);
do $detect_corruption$
declare v jsonb;
begin
 v:=public.preview_business_opening_readiness(
  '89b00000-0000-4000-9000-000000000021');
 if v->>'technicalChecklistComplete'<>'false'
  or v->'customerOpening'->>'accountMismatches'<>'1' then
  raise exception 'Opening debt mismatch was not detected: %',v;
 end if;
end;
$detect_corruption$;
reset role;
rollback to savepoint corrupted_money;
release savepoint corrupted_money;

-- A later ordinary count can change stock without changing the
-- historical opening marker. Readiness must detect that drift.
savepoint changed_physical_after_opening;
alter table public.stock disable trigger legacy_scope_business_write;
update public.stock set total_bottles=25
 where product_id='89b00000-0000-4000-9000-000000000041';
alter table public.stock enable trigger legacy_scope_business_write;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89b00000-0000-4000-8000-000000000002',true);
do $detect_physical_drift$
declare v jsonb;
begin
 v:=public.preview_business_opening_readiness(
  '89b00000-0000-4000-9000-000000000021');
 if v->>'technicalChecklistComplete'<>'false'
    or v->'physicalOpening'->>'changedAfterOpening'<>'1' then
  raise exception 'Changed physical count incorrectly marked complete: %',v;
 end if;
end;
$detect_physical_drift$;
reset role;
rollback to savepoint changed_physical_after_opening;
release savepoint changed_physical_after_opening;

-- Even when overall money totals could appear plausible, a mismatch
-- in an exact branded empty obligation must block readiness.
savepoint wrong_owed_crates;
alter table public.crate_obligations disable trigger legacy_scope_business_write;
update public.crate_obligations set quantity=3
 where customer_id='89b00000-0000-4000-9000-000000000051';
alter table public.crate_obligations enable trigger legacy_scope_business_write;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89b00000-0000-4000-8000-000000000002',true);
do $detect_obligation_drift$
declare v jsonb;
begin
 v:=public.preview_business_opening_readiness(
  '89b00000-0000-4000-9000-000000000021');
 if v->>'technicalChecklistComplete'<>'false'
    or v->'customerOpening'->>'accountMismatches'<>'1' then
  raise exception 'Changed crate obligation incorrectly marked complete: %',v;
 end if;
end;
$detect_obligation_drift$;
reset role;
rollback to savepoint wrong_owed_crates;
release savepoint wrong_owed_crates;

-- No unauthenticated or unrelated user may inspect this financial snapshot.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89b00000-0000-4000-8000-000000000004',true);
do $intruder$
begin
 begin
  perform public.preview_business_opening_readiness(
   '89b00000-0000-4000-9000-000000000021');
  raise exception 'Unrelated user read opening checklist' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$intruder$;
reset role;

update private.business_memberships set status='disabled'
 where business_id='89b00000-0000-4000-9000-000000000021';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89b00000-0000-4000-8000-000000000002',true);
do $revoked$
begin
 begin
  perform public.preview_business_opening_readiness(
   '89b00000-0000-4000-9000-000000000021');
  raise exception 'Revoked owner read financial checklist' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$revoked$;
reset role;
rollback;
