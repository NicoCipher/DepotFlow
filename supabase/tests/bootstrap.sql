-- Verification-only. Emulates the minimal slice of the Supabase platform
-- (auth schema/table, auth.uid(), and the anon/authenticated/service_role
-- roles) that every migration in this project assumes already exists.
-- Run once against a disposable Postgres 16 database, before migrations.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  -- Supabase Auth stores email verification here. Registration must check
  -- verified identity, not caller-controlled user_metadata/JWT role claims.
  email_confirmed_at timestamptz
);
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
  -- Supabase Auth executes configured Postgres hook functions as this role.
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin;
  end if;
end $$;
grant usage on schema auth to anon, authenticated;

-- Faithfully emulate Supabase's managed RLS event trigger in disposable CI.
-- Production has SECURITY DEFINER and a fixed pg_catalog search_path. Keeping
-- the real behavior here means a missing explicit ENABLE ROW LEVEL SECURITY
-- in a migration cannot silently pass the reconstruction.
create or replace function public.rls_auto_enable() returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  cmd record;
begin
  for cmd in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and object_type in ('table', 'partitioned table')
  loop
    if cmd.schema_name is not null
      and cmd.schema_name in ('public')
      and cmd.schema_name not in ('pg_catalog', 'information_schema')
      and cmd.schema_name not like 'pg_toast%'
      and cmd.schema_name not like 'pg_temp%' then
      begin
        execute format('alter table if exists %s enable row level security', cmd.object_identity);
        raise log 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      exception when others then
        raise log 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      end;
    else
      raise log 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)',
        cmd.object_identity, cmd.schema_name;
    end if;
  end loop;
end;
$function$;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.rls_auto_enable();

revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
