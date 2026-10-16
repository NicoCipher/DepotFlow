-- M2e-2b: SECURITY DEFINER reads must honor customer ownership too.
-- After M2e-2, new customers share public.customers with the legacy shop.
-- The existing legacy account-summary RPC bypasses RLS and accepts caller
-- supplied customer IDs. Restrict its output at the SAME business boundary.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $restrict$
declare
  v_oid oid;
  v_source text;
  v_original constant text :=
    'where c.id=any(p_customer_ids) and c.archived_at is null;';
  v_replacement constant text :=
    'where c.id=any(p_customer_ids) and c.archived_at is null'
    || ' and private.can_read_legacy_customer(c.business_id);';
begin
  v_oid:= 'public.customer_account_snapshot(uuid[])'::regprocedure;
  if not (select p.prosecdef from pg_catalog.pg_proc p where p.oid=v_oid) then
    raise exception 'Customer snapshot no longer runs with SECURITY DEFINER';
  end if;
  v_source:=pg_catalog.pg_get_functiondef(v_oid);
  if pg_catalog.strpos(v_source,v_original)=0
     or pg_catalog.strpos(
       pg_catalog.substr(v_source,pg_catalog.strpos(v_source,v_original)+1),
       v_original)<>0
     or pg_catalog.strpos(v_source,
       'private.verified_legacy_owner_read()')=0 then
    raise exception 'Customer account snapshot has drifted from reviewed owner guard';
  end if;
  execute pg_catalog.replace(v_source,v_original,v_replacement);
end;
$restrict$;
commit;
