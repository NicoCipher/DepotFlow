-- Verification-only. Emulates the minimal slice of the Supabase platform
-- (auth schema/table, auth.uid(), and the anon/authenticated/service_role
-- roles) that every migration in this project assumes already exists.
-- Run once against a disposable Postgres 16 database, before migrations.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid()
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
end $$;
grant usage on schema auth to anon, authenticated;

-- Supabase's own platform creates this trigger function in every project to
-- auto-enable RLS on new tables; one migration only tightens its grants.
-- Stub it so that migration applies here too.
create or replace function public.rls_auto_enable() returns event_trigger
language plpgsql as $$ begin end $$;
