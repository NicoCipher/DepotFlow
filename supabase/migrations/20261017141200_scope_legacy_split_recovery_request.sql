-- M2f-17: Check Sale must find the original shop's saved sale even when
-- a different business has used the same request UUID.
-- The existing global fence is NOT yet tenant-safe: keep new-shop
-- checkout disabled until a separately reviewed scoped fence cutover.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $scope_original_shop_recovery$
declare
  v_oid oid := 'public.check_split_sale_request(uuid)'::regprocedure;
  v_source text;
  v_old constant text :=
    E'from public.sales where request_id=p_request_id;\n'
    || E'  if found and not private.can_read_legacy_customer(v_sale.business_id) then\n'
    || E'    -- Foreign request IDs MUST NOT be globally fenced.\n'
    || E'    return jsonb_build_object(\'state\',\'absent\');\n'
    || E'  end if;';
  v_new constant text :=
    E'from public.sales where request_id=p_request_id\n'
    || E'    and private.can_read_legacy_customer(business_id);';
begin
  v_source:=pg_catalog.pg_get_functiondef(v_oid);
  if v_source is null
    or pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
    or (length(v_source)-length(replace(v_source,v_old,'')))/length(v_old)<>1 then
    raise exception 'Check Sale original-tenant scope source drift';
  end if;
  execute replace(v_source,v_old,v_new);
end;
$scope_original_shop_recovery$;

commit;
