-- M2f-32: fix review false positives before adding owner confirmation.
-- A later recount (even equal in quantity) invalidates the opening snapshot.
-- Only active customers participate in the "without opening" count.
-- Staged-only, no new grants or status changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $patch_opening_readiness$
declare
  v_oid oid:='public.preview_business_opening_readiness(uuid)'::regprocedure;
  v_src text;
  v_old_customers constant text :=
    'select count(*) into v_customer_openings from public.customer_opening_balances'||E'\n  where business_id=p_business_id;';
  v_new_customers constant text := $new$
select count(*) into v_customer_openings
  from public.customer_opening_balances o
  join public.customers c on c.id=o.customer_id
  where o.business_id=p_business_id
    and c.business_id=p_business_id and c.archived_at is null;$new$;
  v_old_drift constant text := $old$
 -- A tagged opening whose stock was later physically recounted is not
 -- a faithful cutover snapshot. Block it instead of displaying "ready".
 select count(*) into v_physical_drift$old$;
  v_new_drift constant text := $new$
 -- A tagged opening whose stock was recounted is no longer a faithful
 -- original snapshot, even if the new count is zero or IDENTICAL.
 -- Count immutable audit events by exact type/resource, not just values.
 select count(*) into v_physical_drift$new$;
  v_old_tail constant text := $old$
        and s.bottle_type=o.resource_key
    ),-1)<>coalesce((o.result->>'quantity')::int,-1))
 );
 select ($old$;
  v_new_tail constant text := $new$
        and s.bottle_type=o.resource_key
    ),-1)<>coalesce((o.result->>'quantity')::int,-1))
   or exists(
     select 1 from private.business_product_stock_counts a
     where o.kind='drink' and a.business_id=o.business_id
       and a.product_id::text=o.resource_key
       and a.request_id<>o.request_id
   )
   or exists(
     select 1 from private.business_empty_crate_counts a
     where o.kind='crate' and a.business_id=o.business_id
       and a.crate_type_id::text=o.resource_key
       and a.request_id<>o.request_id
   )
   or exists(
     select 1 from private.business_empty_bottle_counts a
     where o.kind='bottle' and a.business_id=o.business_id
       and a.bottle_type=o.resource_key
       and a.request_id<>o.request_id
   )
 );
 select ($new$;
  v_count integer;
begin
  v_src:=pg_catalog.pg_get_functiondef(v_oid);
  if v_src is null
    or pg_catalog.strpos(v_src,'private.business_opening_readiness_gate')=0
    or pg_catalog.strpos(v_src,'select count(*) into v_physical_drift')=0
  then
    raise exception 'Readiness source/gate drift; manual review required';
  end if;
  v_count:=(pg_catalog.length(v_src)
   -pg_catalog.length(pg_catalog.replace(v_src,v_old_customers,'')))
    /pg_catalog.length(v_old_customers);
  if v_count<>1 then raise exception 'Customer population source changed: %',v_count;end if;
  v_src:=pg_catalog.replace(v_src,v_old_customers,v_new_customers);
  v_count:=(pg_catalog.length(v_src)
   -pg_catalog.length(pg_catalog.replace(v_src,v_old_drift,'')))
    /pg_catalog.length(v_old_drift);
  if v_count<>1 then raise exception 'Drift query source changed: %',v_count;end if;
  v_src:=pg_catalog.replace(v_src,v_old_drift,v_new_drift);
  v_count:=(pg_catalog.length(v_src)
   -pg_catalog.length(pg_catalog.replace(v_src,v_old_tail,'')))
    /pg_catalog.length(v_old_tail);
  if v_count<>1 then raise exception 'Drift query tail changed: %',v_count;end if;
  v_src:=pg_catalog.replace(v_src,v_old_tail,v_new_tail);
  execute v_src;
end;
$patch_opening_readiness$;
commit;
