-- M2f-38: prerequisite Auth-side signup policy (NOT enabled in Auth settings).
-- CRITICAL: UI env flags do NOT protect the directly callable GoTrue /signup
-- endpoint. Before allowing signups, configure the Before User Created
-- Postgres Auth Hook to call this function and test direct /auth/v1/signup.
-- The private switch is OFF even if that hook is accidentally connected.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.business_auth_signup_gate(
 singleton boolean primary key default true check(singleton is true),
 enabled boolean not null default false
);
insert into private.business_auth_signup_gate(singleton,enabled)
 values(true,false);
alter table private.business_auth_signup_gate enable row level security;
revoke all on private.business_auth_signup_gate
 from public,anon,authenticated,service_role;

create function private.depotflow_before_user_created(event jsonb)
returns jsonb
language plpgsql security definer set search_path=''
as $auth_signup$
begin
 -- Supabase Auth calls this hook before user creation, not as the eventual
 -- user; do NOT call auth.uid() or trust user_metadata for permission.
 -- Fail closed on absent/invalid payload and when signup is disabled.
 if pg_catalog.jsonb_typeof(event) is distinct from 'object'
  or pg_catalog.jsonb_typeof(event->'user') is distinct from 'object'
  or coalesce(event->'user'->>'email','') !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  or not exists(
    select 1 from private.business_auth_signup_gate
    where singleton is true and enabled is true
  ) then
  return pg_catalog.jsonb_build_object(
    'error',pg_catalog.jsonb_build_object(
      'http_code',403,
      'message','Account registration is not available.'
    )
  );
 end if;
 return '{}'::jsonb;
end;
$auth_signup$;
revoke all on function private.depotflow_before_user_created(jsonb)
 from public,anon,authenticated,service_role;
-- Supabase Auth's dedicated execution role only; no app-user API access.
grant usage on schema private to supabase_auth_admin;
grant execute on function private.depotflow_before_user_created(jsonb)
 to supabase_auth_admin;
commit;
