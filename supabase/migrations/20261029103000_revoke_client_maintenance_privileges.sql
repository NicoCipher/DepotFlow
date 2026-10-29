-- Remove leftover non-DML maintenance grants from client API roles.
-- PostgreSQL 17 production metadata showed anon/authenticated could TRUNCATE,
-- create triggers, add REFERENCES, and MAINTAIN these two public tables.
-- RLS does not protect TRUNCATE. Keep the owner/service role model unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $preflight$
declare
  v_table text;
  v_role text;
  v_privilege text;
begin
  foreach v_table in array array[
    'public.sale_empty_decisions',
    'public.shop_profile'
  ] loop
    foreach v_role in array array['anon','authenticated'] loop
      foreach v_privilege in array array[
        'TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
      ] loop
        if not has_table_privilege(v_role,v_table,v_privilege) then
          raise exception 'Unexpected privilege state before hardening: % lacks % on %',
            v_role,v_privilege,v_table;
        end if;
      end loop;
    end loop;
  end loop;

  if has_table_privilege('anon','public.sale_empty_decisions','SELECT')
     or has_table_privilege('anon','public.shop_profile','SELECT')
     or not has_table_privilege('authenticated','public.sale_empty_decisions','SELECT')
     or not has_table_privilege('authenticated','public.shop_profile','SELECT') then
    raise exception 'Unexpected client SELECT grant state; stop and review before hardening';
  end if;
end;
$preflight$;

revoke truncate, references, trigger, maintain
  on table public.sale_empty_decisions, public.shop_profile
  from anon, authenticated;

do $postflight$
declare
  v_table text;
  v_role text;
  v_privilege text;
begin
  foreach v_table in array array[
    'public.sale_empty_decisions',
    'public.shop_profile'
  ] loop
    foreach v_role in array array['anon','authenticated'] loop
      foreach v_privilege in array array[
        'TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'
      ] loop
        if has_table_privilege(v_role,v_table,v_privilege) then
          raise exception 'Client maintenance privilege remains: % has % on %',
            v_role,v_privilege,v_table;
        end if;
      end loop;
    end loop;
  end loop;

  -- This migration must not change intended SELECT access or app DML grants.
  if has_table_privilege('anon','public.sale_empty_decisions','SELECT')
     or has_table_privilege('anon','public.shop_profile','SELECT')
     or not has_table_privilege('authenticated','public.sale_empty_decisions','SELECT')
     or not has_table_privilege('authenticated','public.shop_profile','SELECT') then
    raise exception 'Client SELECT access changed during maintenance-grant hardening';
  end if;

  if has_table_privilege('authenticated','public.sale_empty_decisions','INSERT')
     or has_table_privilege('authenticated','public.sale_empty_decisions','UPDATE')
     or has_table_privilege('authenticated','public.sale_empty_decisions','DELETE')
     or has_table_privilege('authenticated','public.shop_profile','INSERT')
     or has_table_privilege('authenticated','public.shop_profile','UPDATE')
     or has_table_privilege('authenticated','public.shop_profile','DELETE') then
    raise exception 'Unexpected client DML privilege detected after hardening';
  end if;
end;
$postflight$;

commit;
