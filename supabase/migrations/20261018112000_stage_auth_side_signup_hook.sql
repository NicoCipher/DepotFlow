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

-- GoTrue's Before User Created hook runs BEFORE the auth.users INSERT, in a
-- separate transaction. Merely flipping the hook's gate OFF can therefore
-- permit an already-accepted signup to commit AFTER the operator closes it.
-- Recheck the policy atomically inside the actual INSERT transaction.
--
-- SELECT FOR SHARE holds a row lock until user creation COMMIT/ROLLBACK.
-- Closing the gate (UPDATE of the same row) must wait for accepted inserts
-- to finish; a signup that arrives after the close sees enabled=false.
-- Privileged postgres-owned migrations/fixture loads remain possible. Normal
-- GoTrue inserts execute as the dedicated supabase_auth_admin DB login.
create function private.depotflow_auth_user_insert_guard()
returns trigger
language plpgsql volatile security definer set search_path=''
as $before_auth_insert$
declare
 v_enabled boolean;
begin
 if session_user = 'postgres' then
   return new;
 end if;
 select g.enabled into v_enabled
 from private.business_auth_signup_gate g
 where g.singleton is true
 for share;
 if v_enabled is distinct from true then
   raise exception 'Account registration is not available.'
     using errcode='42501';
 end if;
 return new;
end;
$before_auth_insert$;
revoke all on function private.depotflow_auth_user_insert_guard()
 from public,anon,authenticated,service_role;
-- Trigger functions are not directly callable. Keep the internal function
-- unreachable through ordinary app/API roles, while the trigger runs as
-- its trusted definer.
create trigger depotflow_auth_user_insert_guard
 before insert on auth.users
 for each row execute function private.depotflow_auth_user_insert_guard();
commit;
