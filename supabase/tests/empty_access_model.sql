-- Access-model review for the three objects previously flagged by the
-- production metadata inventory. This is metadata-only and uses disposable PG17.
begin;

do $empty_access_model$
declare
  v_definition text;
  v_oid oid;
  v_name text;
  v_role text;
begin
  -- known_empty_crates is a security-invoker VIEW, not an RLS-protected table.
  select c.oid,c.relkind, c.reloptions
    into v_oid,v_name,v_definition
  from pg_class c
  where c.oid='public.known_empty_crates'::regclass;
  if v_name is distinct from 'v' then
    raise exception 'known_empty_crates must remain a view, not a table';
  end if;
  if not coalesce(v_definition::text like '%security_invoker=true%',false) then
    raise exception 'known_empty_crates must use security_invoker=true';
  end if;
  if not has_table_privilege('authenticated','public.known_empty_crates','SELECT')
     or has_table_privilege('anon','public.known_empty_crates','SELECT') then
    raise exception 'known_empty_crates SELECT grant is not authenticated-only';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.crate_types'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.empty_crate_stock'::regclass) then
    raise exception 'known_empty_crates underlying tables must retain RLS';
  end if;
  if not exists (
    select 1 from pg_policy
    where polrelid='public.crate_types'::regclass and polname='owner_read'
  ) or not exists (
    select 1 from pg_policy
    where polrelid='public.empty_crate_stock'::regclass and polname='owner_read'
  ) then
    raise exception 'known_empty_crates underlying owner policies are missing';
  end if;

  -- Private return/held ledgers deliberately have no direct client grants.
  -- RLS being off on these tables is safe only while every access path is
  -- mediated by owner-checked, tenant-scoped SECURITY DEFINER routines.
  foreach v_name in array array[
    'private.customer_empty_returns','private.held_empty_collections'
  ] loop
    v_oid:=v_name::regclass;
    if has_schema_privilege('anon','private','USAGE') then
      raise exception 'anon must not have private schema usage';
    end if;
    foreach v_role in array array['anon','authenticated','service_role'] loop
      if has_table_privilege(v_role,v_oid,'SELECT')
        or has_table_privilege(v_role,v_oid,'INSERT')
        or has_table_privilege(v_role,v_oid,'UPDATE')
        or has_table_privilege(v_role,v_oid,'DELETE')
        or has_table_privilege(v_role,v_oid,'TRUNCATE')
        or has_table_privilege(v_role,v_oid,'REFERENCES')
        or has_table_privilege(v_role,v_oid,'TRIGGER') then
        raise exception 'Direct % privilege leaked on % to %', 'table',v_name,v_role;
      end if;
    end loop;
  end loop;

  -- These are the exposed/privileged code paths that read the private ledgers.
  -- Every one must verify the legacy owner and apply the business-scoped
  -- customer predicate before returning or changing customer-linked records.
  foreach v_name in array array[
    'private.record_customer_empty_return(uuid,uuid,jsonb,jsonb,uuid[])',
    'private.release_held_empties(uuid)',
    'public.customer_recent_activity(uuid)',
    'public.customer_records(date,date,text,text,text,integer,jsonb,boolean)',
    'public.customer_return_record(uuid)',
    'public.store_activity(date,date,uuid,text,integer,integer)'
  ] loop
    v_oid:=v_name::regprocedure;
    select pg_get_functiondef(v_oid) into v_definition;
    if not (select prosecdef from pg_proc where oid=v_oid)
      or position('private.verified_legacy_owner_read()' in v_definition)=0
      or position('private.can_read_legacy_customer(' in v_definition)=0 then
      raise exception 'Owner/business guard missing from %',v_name;
    end if;
  end loop;

  -- Client API roles must not retain table-maintenance privileges that bypass
  -- RLS, especially TRUNCATE. The forward-only hardening migration removes
  -- all four non-DML maintenance privileges while preserving authenticated
  -- SELECT and keeping anon SELECT denied.
  foreach v_name in array array[
    'public.sale_empty_decisions','public.shop_profile'
  ] loop
    foreach v_role in array array['anon','authenticated'] loop
      if has_table_privilege(v_role,v_name,'TRUNCATE')
        or has_table_privilege(v_role,v_name,'REFERENCES')
        or has_table_privilege(v_role,v_name,'TRIGGER')
        or has_table_privilege(v_role,v_name,'MAINTAIN') then
        raise exception 'Client role % retains a maintenance privilege on %',v_role,v_name;
      end if;
    end loop;
  end loop;

  if has_table_privilege('anon','public.sale_empty_decisions','SELECT')
    or has_table_privilege('anon','public.shop_profile','SELECT')
    or not has_table_privilege('authenticated','public.sale_empty_decisions','SELECT')
    or not has_table_privilege('authenticated','public.shop_profile','SELECT') then
    raise exception 'Maintenance hardening changed intended SELECT access';
  end if;
end;
$empty_access_model$;

rollback;
