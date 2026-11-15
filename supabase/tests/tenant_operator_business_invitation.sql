-- Controlled operator invitation and provisioning.
-- Disposable PostgreSQL only. All auth/business fixtures roll back.
begin;

alter table auth.users add column if not exists email text;
alter table auth.users add column if not exists invited_at timestamptz;
create unique index if not exists depotflow_ci_auth_email_unique
  on auth.users(pg_catalog.lower(email)) where email is not null;
grant usage on schema auth to supabase_auth_admin;
grant insert on auth.users to supabase_auth_admin;

-- Global public signup remains closed.
do $signup_closed$
begin
 if (select enabled from private.business_auth_signup_gate where singleton) is distinct from false then
  raise exception 'Public signup gate must remain OFF';
 end if;
end;
$signup_closed$;

-- The operator can prepare a single email/depot invitation. Replays with
-- identical details are safe; changed payloads and duplicate pending emails fail.
do $prepare_invite$
declare v jsonb; r jsonb;
begin
 v:=private.prepare_business_invitation(
  '96000000-0000-4000-8000-000000000001',
  'pilot-owner@example.test',
  'Pilot Depot A','12 Example Road, Lagos','08000000001');
 r:=private.prepare_business_invitation(
  '96000000-0000-4000-8000-000000000001',
  'pilot-owner@example.test',
  'Pilot Depot A','12 Example Road, Lagos','08000000001');
 if v->>'status'<>'prepared' or v->>'savedReplay'<>'false'
    or r->>'savedReplay'<>'true' then
  raise exception 'Invitation preparation/replay failed: %, %',v,r;
 end if;
 begin
  perform private.prepare_business_invitation(
   '96000000-0000-4000-8000-000000000002',
   'pilot-owner@example.test',
   'Different Depot','13 Example Road, Lagos','08000000002');
  raise exception 'Duplicate pending email was accepted';
 exception when unique_violation then null;
 end;
 begin
  perform private.prepare_business_invitation(
   '96000000-0000-4000-8000-000000000001',
   'pilot-owner@example.test',
   'Changed Depot','12 Example Road, Lagos','08000000001');
  raise exception 'Changed request payload was accepted';
 exception when invalid_parameter_value then null;
 end;
end;
$prepare_invite$;

-- Hook permits only the prepared address; all other addresses remain denied.
set local role supabase_auth_admin;
do $hook_allowlist$
declare v jsonb;
begin
 v:=private.depotflow_before_user_created(
  '{"user":{"email":"pilot-owner@example.test"}}'::jsonb);
 if v is distinct from '{}'::jsonb then
  raise exception 'Prepared email was rejected by Auth hook: %',v;
 end if;
 v:=private.depotflow_before_user_created(
  '{"user":{"email":"uninvited@example.test"}}'::jsonb);
 if v->'error'->>'http_code'<>'403' then
  raise exception 'Uninvited email passed Auth hook: %',v;
 end if;
end;
$hook_allowlist$;
reset role;

-- Simulate GoTrue's actual database login. A normal public signup has no
-- invited_at marker and must still be denied even with an email allowlist.
set session authorization supabase_auth_admin;
do $reject_non_invite$
begin
 begin
  insert into auth.users(id,email,invited_at)
  values('96000000-0000-4000-8000-000000000099',
         'pilot-owner@example.test',null);
  raise exception 'Non-invited Auth user was inserted';
 exception when insufficient_privilege then null;
 end;
end;
$reject_non_invite$;
reset session authorization;

-- A real invite carries invited_at and consumes the exact pending email in
-- the same auth.users transaction.
set session authorization supabase_auth_admin;
insert into auth.users(id,email,invited_at)
values(
 '96000000-0000-4000-8000-000000000011',
 'pilot-owner@example.test',
 pg_catalog.now()
);
reset session authorization;

do $consumed$
begin
 if not exists(
  select 1 from private.business_invitation_requests
  where request_id='96000000-0000-4000-8000-000000000001'
   and status='user_created'
   and invited_user_id='96000000-0000-4000-8000-000000000011'
   and consumed_at is not null
 ) then
  raise exception 'Auth insert did not atomically consume the invitation';
 end if;
end;
$consumed$;

-- Provisioning is operator-only, atomic, and idempotent.
do $provision$
declare v jsonb; r jsonb; v_business uuid;
begin
 v:=private.provision_invited_business(
  '96000000-0000-4000-8000-000000000001');
 v_business:=(v->>'businessId')::uuid;
 r:=private.provision_invited_business(
  '96000000-0000-4000-8000-000000000001');
 if v->>'status'<>'setup' or v->>'savedReplay'<>'false'
    or r->>'savedReplay'<>'true' or r->>'businessId'<>v_business::text then
  raise exception 'Provisioning/replay mismatch: %, %',v,r;
 end if;
 if not exists(
  select 1 from private.business_memberships
  where business_id=v_business
   and user_id='96000000-0000-4000-8000-000000000011'
   and member_kind='owner' and status='active'
 ) or not exists(
  select 1 from public.business_profiles
  where business_id=v_business
   and name='Pilot Depot A'
   and address='12 Example Road, Lagos'
   and phone='08000000001'
 ) or not exists(
  select 1 from private.business_registration_requests
  where owner_id='96000000-0000-4000-8000-000000000011'
   and request_id='96000000-0000-4000-8000-000000000001'
   and business_id=v_business
 ) then
  raise exception 'Business, membership, profile or registration audit row missing';
 end if;
end;
$provision$;

-- Once an Auth user exists, a new invitation request for that email is refused.
do $existing_auth_user$
begin
 begin
  perform private.prepare_business_invitation(
   '96000000-0000-4000-8000-000000000004',
   'pilot-owner@example.test',
   'Another Depot','99 Other Road, Lagos','08000000004');
  raise exception 'An existing Auth account was re-invited';
 exception when unique_violation then null;
 end;
end;
$existing_auth_user$;

-- Expired invitations no longer pass the Auth hook or INSERT guard.
select private.prepare_business_invitation(
 '96000000-0000-4000-8000-000000000003',
 'expired-owner@example.test',
 'Expired Depot','1 Expired Road, Lagos','08000000003');
update private.business_invitation_requests
 set expires_at=pg_catalog.now()-interval '1 minute'
 where request_id='96000000-0000-4000-8000-000000000003';
set local role supabase_auth_admin;
do $expired_hook$
declare v jsonb;
begin
 v:=private.depotflow_before_user_created(
  '{"user":{"email":"expired-owner@example.test"}}'::jsonb);
 if v->'error'->>'http_code'<>'403' then
  raise exception 'Expired invitation passed Auth hook: %',v;
 end if;
end;
$expired_hook$;
reset role;
set session authorization supabase_auth_admin;
do $expired_insert$
begin
 begin
  insert into auth.users(id,email,invited_at)
  values('96000000-0000-4000-8000-000000000033',
         'expired-owner@example.test',pg_catalog.now());
  raise exception 'Expired invitation was consumed';
 exception when insufficient_privilege then null;
 end;
end;
$expired_insert$;
reset session authorization;

-- Private invitation controls are not exposed to app/API roles.
do $private_boundary$
begin
 if has_table_privilege('anon','private.business_invitation_requests','SELECT')
    or has_table_privilege('authenticated','private.business_invitation_requests','SELECT')
    or has_table_privilege('service_role','private.business_invitation_requests','SELECT')
    or has_function_privilege('anon','private.prepare_business_invitation(uuid,text,text,text,text)','EXECUTE')
    or has_function_privilege('authenticated','private.prepare_business_invitation(uuid,text,text,text,text)','EXECUTE')
    or has_function_privilege('service_role','private.prepare_business_invitation(uuid,text,text,text,text)','EXECUTE')
    or has_function_privilege('anon','private.provision_invited_business(uuid)','EXECUTE')
    or has_function_privilege('authenticated','private.provision_invited_business(uuid)','EXECUTE')
    or has_function_privilege('service_role','private.provision_invited_business(uuid)','EXECUTE')
 then
  raise exception 'Operator invitation controls are exposed to app/API roles';
 end if;
 if has_function_privilege('anon','private.depotflow_auth_user_insert_guard()','EXECUTE')
    or has_function_privilege('authenticated','private.depotflow_auth_user_insert_guard()','EXECUTE')
    or not has_function_privilege('supabase_auth_admin','private.depotflow_before_user_created(jsonb)','EXECUTE') then
  raise exception 'Auth hook/trigger grants are not restricted';
 end if;
end;
$private_boundary$;

rollback;
