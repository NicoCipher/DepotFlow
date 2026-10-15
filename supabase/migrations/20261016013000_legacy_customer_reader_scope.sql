-- M2e-2c: complete owner-only SECURITY DEFINER customer reader isolation.
-- RLS cannot protect rows read as the function owner; every customer join
-- in the four pre-existing privileged reporting RPCs must be scoped itself.
-- This leaves original business calculations, pagination, output signatures,
-- and owner authentication untouched.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $restrict$
declare
  r record;
  v_oid oid;
  v_source text;
  v_original text;
  v_secure text;
  v_hits integer;
  v_found integer;
  v_alias text;
  v_total integer;
  v_rewrites integer:=0;
begin
  for r in
    select * from (values
      ('customer_recent_activity','p_customer uuid',6),
      ('customer_records',
       'p_from date, p_to date, p_kind text, p_method text, p_search text, p_limit integer, p_cursor jsonb, p_before boolean',4),
      ('customer_return_record','p_id uuid',1),
      ('store_activity','p_from date, p_to date, p_customer uuid, p_type text, p_limit integer, p_offset integer',6)
    ) as guarded(name,identity_args,expected_customer_joins)
  loop
    select p.oid into v_oid
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace ns on ns.oid=p.pronamespace
    where ns.nspname='public' and p.proname=r.name
      and pg_catalog.pg_get_function_identity_arguments(p.oid)=r.identity_args
      and p.prosecdef is true
      and p.prolang=(select oid from pg_catalog.pg_language
                      where lanname='plpgsql');
    if v_oid is null then
      raise exception 'Privileged customer RPC definition changed: %',r.name;
    end if;
    v_source:=pg_catalog.pg_get_functiondef(v_oid);
    if pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
       or pg_catalog.strpos(
         v_source,'private.can_read_legacy_customer(c.business_id)')<>0 then
      raise exception 'Owner guard or customer-scope drift in RPC: %',r.name;
    end if;

    v_total:=0;
    foreach v_alias in array ARRAY['s','p','r','h','o']::text[] loop
      v_original:='join public.customers c on c.id='||v_alias||'.customer_id';
      v_secure:=v_original||' and private.can_read_legacy_customer(c.business_id)';
      v_hits:=(pg_catalog.length(v_source)
         -pg_catalog.length(pg_catalog.replace(v_source,v_original,'')))
         / pg_catalog.length(v_original);
      if v_hits>0 then
        v_source:=pg_catalog.replace(v_source,v_original,v_secure);
        v_total:=v_total+v_hits;
      end if;
    end loop;
    if v_total<>r.expected_customer_joins
       or pg_catalog.strpos(v_source,'join public.customers c on c.id=')=0
       or (pg_catalog.length(v_source)
           -pg_catalog.length(pg_catalog.replace(
             v_source,'private.can_read_legacy_customer(c.business_id)','')))
             / pg_catalog.length('private.can_read_legacy_customer(c.business_id)')
           <> r.expected_customer_joins then
      raise exception 'Expected % scoped customer joins in %, got %',
        r.expected_customer_joins,r.name,v_total;
    end if;
    execute v_source;
    v_rewrites:=v_rewrites+1;
  end loop;
  if v_rewrites<>4 then
    raise exception 'Exactly four reporting RPCs must be patched';
  end if;
end;
$restrict$;
commit;
