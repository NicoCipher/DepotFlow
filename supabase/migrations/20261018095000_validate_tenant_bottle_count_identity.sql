-- M2f-29: close arbitrary exact-empty-bottle counts in the underlying
-- new-depot count RPC. The wrapper's validation is not enough: callers may
-- eventually receive an explicit direct count permission after onboarding.
-- Preserve saved immutable audit replay even after a product is removed.
-- No grants, release gates or live writes are changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $validate_new_bottle_count_identity$
declare
 v_oid oid :=
  'public.count_business_empty_bottles(uuid,uuid,text,integer,integer,date)'::regprocedure;
 v_source text;
 v_anchor constant text :=
  '  select quantity into v_previous from public.empty_bottle_stock';
 v_guard constant text := $guard$
  -- A NEW physical bottle type must belong to an actual configured
  -- returnable drink in THIS business. Existing count event replay above
  -- remains available after a later drink/bottle-type change.
  perform 1 from public.products
    where business_id=p_business_id
      and bottles_returnable is true
      and bottle_type=v_bottle_type
    for share;
  if not found then
    raise exception 'Choose an owned returnable bottle type before counting'
      using errcode='22023';
  end if;

$guard$;
begin
 v_source:=pg_catalog.pg_get_functiondef(v_oid);
 if v_source is null
    or pg_catalog.strpos(v_source,'private.business_bottle_count_gate')=0
    or pg_catalog.strpos(v_source,'select * into v_event from private.business_empty_bottle_counts')=0
    or pg_catalog.strpos(v_source,'return jsonb_build_object(')=0
    or pg_catalog.strpos(v_source,'Choose an owned returnable bottle type before counting')<>0
    or (pg_catalog.length(v_source)
     -pg_catalog.length(pg_catalog.replace(v_source,v_anchor,'')))
       /pg_catalog.length(v_anchor)<>1 then
   raise exception 'Business bottle count source drift; independent review required';
 end if;
 execute pg_catalog.replace(v_source,v_anchor,v_guard||v_anchor);
end;
$validate_new_bottle_count_identity$;
commit;
