-- Rollback-only registration acceptance. Every owner-created depot is
-- independent from the legacy pilot and other verified principals.
begin;
insert into auth.users(id,email_confirmed_at) values
 ('89f00000-0000-4000-8000-000000000001',pg_catalog.now()),
 ('89f00000-0000-4000-8000-000000000002',pg_catalog.now()),
 ('89f00000-0000-4000-8000-000000000003',null),
 ('89f00000-0000-4000-8000-000000000004',pg_catalog.now());
insert into private.shop_owner(user_id)
 values('89f00000-0000-4000-8000-000000000004');
select private.link_legacy_shop_business();

do $off_by_default$
begin
 if (select enabled from private.business_registration_gate)
 or has_function_privilege('authenticated',
   'public.register_my_business(uuid,text,text,text)','EXECUTE')
 or has_function_privilege('anon',
   'public.register_my_business(uuid,text,text,text)','EXECUTE')
 or has_function_privilege('authenticated',
   'public.can_register_business()','EXECUTE')
 then
  raise exception 'Registration accidentally exposed before release';
 end if;
end;
$off_by_default$;
grant execute on function public.register_my_business(uuid,text,text,text)
 to authenticated;
grant execute on function public.can_register_business()
 to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89f00000-0000-4000-8000-000000000001',true);
do $default_denial$
begin
 if public.can_register_business() then
  raise exception 'Registration gate default is ON';
 end if;
 begin
  perform public.register_my_business(
   '89f00000-0000-4000-9000-000000000041',
   'Test Depot','Ikeja','08005550041');
  raise exception 'Default-off gate bypassed' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$default_denial$;
reset role;
update private.business_selection_gate set enabled=true where singleton;
update private.business_registration_gate set enabled=true where singleton;

-- Failure on the LAST insert must roll back business, membership and
-- profile together, leaving NO ghost depot from an interrupted request.
create function pg_temp.reject_one_registration()
returns trigger language plpgsql as $reject$
begin
 if new.request_id='89f00000-0000-4000-9000-000000000049'::uuid then
  raise exception 'Injected audit insert failure' using errcode='22023';
 end if;
 return new;
end;
$reject$;
create trigger disposable_registration_failure
 after insert on private.business_registration_requests
 for each row execute function pg_temp.reject_one_registration();

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89f00000-0000-4000-8000-000000000001',true);
do $verified_one$
declare
 v jsonb;
 replay jsonb;
 dep uuid;
begin
 if not public.can_register_business() then
  raise exception 'Confirmed owner incorrectly ineligible';
 end if;
 begin
  perform public.register_my_business(
   '89f00000-0000-4000-9000-000000000049',
   'Ghost Depot','Agege','08005550049');
  raise exception 'Injected audit failure was ignored' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;

 v:=public.register_my_business(
  '89f00000-0000-4000-9000-000000000041',
  '  Official   Depot A  ','Ikeja,   Lagos','08005550041');
 dep:=(v->>'businessId')::uuid;
 if v->>'businessName'<>'Official Depot A'
  or v->>'status'<>'setup'
  or v->>'canOperate'<>'false'
  or v->>'savedReplay'<>'false'
 then raise exception 'Bad business creation response: %',v;end if;

 replay:=public.register_my_business(
  '89f00000-0000-4000-9000-000000000041',
  'Official Depot A','Ikeja, Lagos','08005550041');
 if replay->>'businessId' is distinct from dep::text
   or replay->>'savedReplay'<>'true'
 then raise exception 'Idempotent business registration failed: %',replay;end if;

 if (select count(*) from public.business_profiles)<>1
 or (select count(*) from public.list_my_businesses_for_setup())<>1 then
  raise exception 'Registration request created duplicate partial records';
 end if;
 begin
  perform public.register_my_business(
   '89f00000-0000-4000-9000-000000000041',
   'Altered Depot Name','Ikeja, Lagos','08005550041');
  raise exception 'Changed replay payload overwritten business' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.register_my_business(
   '89f00000-0000-4000-9000-000000000042',
   'Official Depot A','Ikeja, Lagos','08005550041');
  raise exception 'Duplicate same branch used another request ID' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;

 -- Two branches are valid if the same brand serves DIFFERENT addresses.
 perform public.register_my_business(
  '89f00000-0000-4000-9000-000000000043',
  'Official Depot A','Yaba, Lagos','08005550043');
 perform public.register_my_business(
  '89f00000-0000-4000-9000-000000000044',
  'Official Depot C','Ojota, Lagos','08005550044');
 if public.can_register_business() then
  raise exception 'Owner exceeded registration cap of 3';
 end if;
 begin
  perform public.register_my_business(
   '89f00000-0000-4000-9000-000000000045',
   'Fourth branch','Surulere, Lagos','08005550045');
  raise exception 'Fourth branch bypassed per-owner cap' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 if (select count(*) from public.list_my_businesses_for_setup())<>3 then
  raise exception 'Registered owned depots unavailable in business picker';
 end if;
 begin
  insert into private.business_memberships(
   business_id,user_id,member_kind,status
  ) values(dep,'89f00000-0000-4000-8000-000000000002','owner','active');
  raise exception 'Ordinary user forged additional membership' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$verified_one$;
reset role;

-- Second verified user may use the SAME UUID/name/address, yet all data
-- must belong to this second actor and remain invisible to the first.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89f00000-0000-4000-8000-000000000002',true);
do $verified_other$
declare v jsonb;
begin
 v:=public.register_my_business(
  '89f00000-0000-4000-9000-000000000041',
  'Official Depot A','Ikeja, Lagos','08005550041');
 if v->>'savedReplay'<>'false'
 or (select count(*) from public.list_my_businesses_for_setup())<>1 then
  raise exception 'Second owner mixed registrations from A';
 end if;
 if (select business_name from public.list_my_businesses_for_setup())
   <>'Official Depot A' then
  raise exception 'Other owner cannot see their business name';
 end if;
end;
$verified_other$;
reset role;

-- A person with an unconfirmed email cannot register, despite holding an
-- otherwise valid auth UID. No JWT role or user_metadata can bypass this.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89f00000-0000-4000-8000-000000000003',true);
do $unverified$
begin
 if public.can_register_business() then
  raise exception 'Unconfirmed email considered eligible';
 end if;
 begin
  perform public.register_my_business(
   '89f00000-0000-4000-9000-000000000046',
   'Unconfirmed Depot','Ikeja','08005550046');
  raise exception 'Unverified account registered' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$unverified$;
reset role;

-- A legacy owner may separately register a NEW depot but must not mutate
-- or silently convert their original legacy singleton.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89f00000-0000-4000-8000-000000000004',true);
do $legacy_not_converted$
declare v jsonb;
begin
 v:=public.register_my_business(
  '89f00000-0000-4000-9000-000000000047',
  'Independent Owner Depot','Yaba','08005550047');
 if v->>'canOperate'<>'false'
 or (select count(*) from public.list_my_businesses_for_setup())<>1 then
  raise exception 'Legacy user registration failed isolation';
 end if;
end;
$legacy_not_converted$;
reset role;

do $physical_integrity$
begin
 if (select count(*) from private.business_registration_requests)<>5
 or (select count(*) from public.business_profiles)<>5
 or (select count(*) from private.business_memberships
     where business_id in (
       select id from private.businesses where legacy_singleton is null))<>5
 or (select count(*) from private.businesses
     where status='setup' and legacy_singleton is null)<>5
 or (select count(*) from private.businesses
     where legacy_singleton is true)<>1
 or exists(select 1 from private.business_registration_requests
     where business_name='Ghost Depot') then
  raise exception 'Registration atomicity/legacy separation violated';
 end if;
end;
$physical_integrity$;
rollback;
