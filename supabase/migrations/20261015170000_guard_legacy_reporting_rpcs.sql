-- M2d-3: privileged owner-only reports must respect a disabled membership.
--
-- SECURITY DEFINER routines bypass RLS even after M2d-2 changes read policies.
-- Restrict only six existing OWNER-ONLY report/lookup RPCs; receipt verification
-- remains intentionally public by verification token and is NOT changed.
--
-- No records modified. Before M2d-1 activation, the helper preserves the
-- pilot's original single-shop owner behavior. Once activated, both checks
-- must pass. Real second-business enrollment remains disabled.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $guard$
declare
  r record;
  v_oid oid;
  v_source text;
  v_updated text;
  v_count integer:=0;
  v_old constant text:='if auth.uid() is null or not exists';
  v_replacement constant text:=
    'if not private.verified_legacy_owner_read() or not exists';
begin
  for r in
    select * from (values
      ('customer_account_snapshot','p_customer_ids uuid[]'),
      ('customer_recent_activity','p_customer uuid'),
      ('customer_records','p_from date, p_to date, p_kind text, p_method text, p_search text, p_limit integer, p_cursor jsonb, p_before boolean'),
      ('customer_return_record','p_id uuid'),
      ('manager_snapshot','p_day date'),
      ('store_activity','p_from date, p_to date, p_customer uuid, p_type text, p_limit integer, p_offset integer')
    ) as owner_rpc(name, signature)
  loop
    select p.oid into v_oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname=r.name
      and pg_catalog.pg_get_function_identity_arguments(p.oid)=r.signature
      and p.prokind='f' and p.prosecdef
      and p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql');
    if v_oid is null then
      raise exception 'Expected SECURITY DEFINER report missing or altered: %(%)',
        r.name,r.signature;
    end if;

    v_source:=pg_catalog.pg_get_functiondef(v_oid);
    -- Deliberate fail-closed guard against upstream body/API changes:
    -- exactly one original authorization check, and no prior replacement.
    if pg_catalog.strpos(v_source,v_old)=0
      or pg_catalog.strpos(
        pg_catalog.substr(v_source,pg_catalog.strpos(v_source,v_old)+1),
        v_old
      )<>0
      or pg_catalog.strpos(v_source,v_replacement)<>0 then
      raise exception 'Owner check drift in privileged report: %',r.name;
    end if;
    v_updated:=pg_catalog.replace(v_source,v_old,v_replacement);
    execute v_updated;
    v_count:=v_count+1;
  end loop;
  if v_count<>6 then
    raise exception 'Expected exactly six privileged report guards, got %',
      v_count;
  end if;
end;
$guard$;
commit;
