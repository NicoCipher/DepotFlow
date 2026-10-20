-- M2f-42: a 250-row preview cap must never silently hide catalogue,
-- crate, or configured product rows that are needed for opening setup.
-- Stage exact database-side totals and a fail-closed truncation flag.
-- The frontend rejects incomplete snapshots rather than showing a subset
-- as if it were the whole depot. No new grants or gate activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $add_assortment_preview_completeness$
declare
 v_oid oid:=
  'public.preview_business_assortment_setup(uuid)'::regprocedure;
 v_source text;
 v_declare_old constant text :=
  E' v_products jsonb;\nbegin';
 v_declare_new constant text :=
  E' v_products jsonb;\n v_catalogue_total bigint;\n'
  ||E' v_crates_total bigint;\n v_products_total bigint;\nbegin';
 v_return_old constant text :=
  E' return pg_catalog.jsonb_build_object(\n  \'businessId\'';
 v_return_new constant text := $new$
 -- Read total counts from the SAME owner-verified RPC. If catalogue
 -- expands beyond the returned rows, the caller must stop rather than
 -- creating an incomplete assortment or partial opening stock.
 select count(*) into v_catalogue_total from public.product_catalogue;
 select count(*) into v_crates_total from public.crate_types
  where business_id=p_business_id and is_legacy is false;
 select count(*) into v_products_total from public.products
  where business_id=p_business_id;

 return pg_catalog.jsonb_build_object(
  'businessId'$new$;
 v_payload_old constant text :=
  E'  \'catalogue\',v_catalogue,\'crateTypes\',v_crates,\'configuredDrinks\',v_products,\n';
 v_payload_new constant text := $new$
  'catalogue',v_catalogue,'crateTypes',v_crates,'configuredDrinks',v_products,
  'catalogueTotal',v_catalogue_total,
  'crateTypesTotal',v_crates_total,
  'configuredDrinksTotal',v_products_total,
  'truncated',(
    v_catalogue_total>pg_catalog.jsonb_array_length(v_catalogue)
    or v_crates_total>pg_catalog.jsonb_array_length(v_crates)
    or v_products_total>pg_catalog.jsonb_array_length(v_products)
  ),
$new$;
 v_hits integer;
begin
 v_source:=pg_catalog.pg_get_functiondef(v_oid);
 if v_source is null
 or pg_catalog.strpos(v_source,'private.business_assortment_setup_gate')=0
 or pg_catalog.strpos(v_source,'limit 250')=0
 or pg_catalog.strpos(v_source,'catalogueTotal')<>0 then
  raise exception 'Assortment preview source changed; review pagination';
 end if;
 v_hits:=(pg_catalog.length(v_source)
  -pg_catalog.length(pg_catalog.replace(v_source,v_declare_old,'')))
   /pg_catalog.length(v_declare_old);
 if v_hits<>1 then
  raise exception 'Expected one assortment declaration, got %',v_hits;
 end if;
 v_source:=pg_catalog.replace(v_source,v_declare_old,v_declare_new);
 v_hits:=(pg_catalog.length(v_source)
  -pg_catalog.length(pg_catalog.replace(v_source,v_return_old,'')))
   /pg_catalog.length(v_return_old);
 if v_hits<>1 then raise exception 'Assortment return drift: %',v_hits;end if;
 v_source:=pg_catalog.replace(v_source,v_return_old,v_return_new);
 v_hits:=(pg_catalog.length(v_source)
  -pg_catalog.length(pg_catalog.replace(v_source,v_payload_old,'')))
   /pg_catalog.length(v_payload_old);
 if v_hits<>1 then raise exception 'Assortment payload drift: %',v_hits;end if;
 v_source:=pg_catalog.replace(v_source,v_payload_old,v_payload_new);
 execute v_source;
end;
$add_assortment_preview_completeness$;
commit;
