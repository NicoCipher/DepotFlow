-- DISPOSABLE PG17 ONLY. Detect privilege escalation via WITH GRANT OPTION.
-- This file must NEVER be run against hosted production.
-- The transaction rolls back the temporary privilege change.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '15s';
do $$
declare
  before_hash text;
  after_hash text;
begin
  select md5(string_agg(
    grantee||':'||privilege_type||':'||column_name||':grantable='||is_grantable,
    E'\n' order by grantee,privilege_type,column_name,is_grantable
  )) into before_hash
  from information_schema.column_privileges
  where table_schema='public' and table_name='customers'
    and grantee='authenticated' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');
  if before_hash is null then
    raise exception 'TEST INVALID: no authenticated customer DML columns in historical fixture';
  end if;

  execute 'grant select (id) on public.customers to authenticated with grant option';

  select md5(string_agg(
    grantee||':'||privilege_type||':'||column_name||':grantable='||is_grantable,
    E'\n' order by grantee,privilege_type,column_name,is_grantable
  )) into after_hash
  from information_schema.column_privileges
  where table_schema='public' and table_name='customers'
    and grantee='authenticated' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');
  if before_hash = after_hash then
    raise exception 'SECURITY REGRESSION: grant option not represented in client DML hash';
  end if;
end;
$$;
rollback;
