-- M2f-30: close first-count check/ordinary zero-count race.
-- All count writers and the setup-only opening wrapper acquire the SAME
-- per-business/per-resource advisory lock before reading stock existence.
-- Lock order: verified member -> business request lock -> resource lock ->
-- stock row. No new grants, gates or live migration activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $synchronize_new_business_stock_count_writers$
declare
 r record;
 v_oid oid;
 v_source text;
 v_hits integer;
begin
 for r in
  select * from (values
  (
   'public.count_business_product_stock(uuid,uuid,uuid,numeric,numeric,integer,integer,date)',
   '  select total_bottles into v_current from public.stock',
   $guard$
  -- Serialize with setup opening's NEVER-COUNTED check, including zero.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'drink:'||p_business_id::text||':'||p_product_id::text,0)
  );

$guard$
  ),
  (
   'public.count_business_empty_crates(uuid,uuid,uuid,integer,integer,date)',
   '  select quantity into v_previous from public.empty_crate_stock',
   $guard$
  -- Serialize with setup opening's NEVER-COUNTED check, including zero.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'crate:'||p_business_id::text||':'||p_crate_type_id::text,0)
  );

$guard$
  ),
  (
   'public.count_business_empty_bottles(uuid,uuid,text,integer,integer,date)',
   '  select quantity into v_previous from public.empty_bottle_stock',
   $guard$
  -- Serialize with setup opening's NEVER-COUNTED check, including zero.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'bottle:'||p_business_id::text||':'||v_bottle_type,0)
  );

$guard$
  )
 ) x(signature,anchor,guard_text)
 loop
  v_oid:=pg_catalog.to_regprocedure(r.signature);
  if v_oid is null then
   raise exception 'Expected new-business count function missing: %',r.signature;
  end if;
  v_source:=pg_catalog.pg_get_functiondef(v_oid);
  v_hits:=(pg_catalog.length(v_source)
    -pg_catalog.length(pg_catalog.replace(v_source,r.anchor,'')))
    /pg_catalog.length(r.anchor);
  if v_hits<>1
     or pg_catalog.strpos(v_source,'NEVER-COUNTED check')<>0
     or pg_catalog.strpos(v_source,'private.business_')=0 then
   raise exception 'Underlying count function prerequisite drift: %, matches %',
     r.signature,v_hits;
  end if;
  execute pg_catalog.replace(v_source,r.anchor,r.guard_text||r.anchor);
 end loop;
end;
$synchronize_new_business_stock_count_writers$;

do $synchronize_setup_only_opening_check$
declare
 v_oid oid:=
  'public.record_business_physical_opening(uuid,uuid,text,text,integer,integer,integer,date)'::regprocedure;
 v_src text;
 v_anchor constant text:=$anchor$
 if p_kind='drink' then
  -- No pre-existing stock row$anchor$;
 v_lock constant text:=$guard$
 -- This lock is shared with DIRECT ordinary count writers above. It must
 -- precede the absence check; otherwise a concurrent explicit ZERO row
 -- could be interpreted as "never counted" and overwritten.
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    p_kind||':'||p_business_id::text||':'||v_key,0)
 );

$guard$;
begin
 v_src:=pg_catalog.pg_get_functiondef(v_oid);
 if v_src is null
 or pg_catalog.strpos(v_src,'private.business_physical_opening_lines')=0
 or pg_catalog.strpos(v_src,'NEVER-COUNTED check')<>0
 or (pg_catalog.length(v_src)
  -pg_catalog.length(pg_catalog.replace(v_src,v_anchor,'')))
    /pg_catalog.length(v_anchor)<>1 then
  raise exception 'Opening first-count prerequisite drift';
 end if;
 execute pg_catalog.replace(v_src,v_anchor,v_lock||v_anchor);
end;
$synchronize_setup_only_opening_check$;
commit;
