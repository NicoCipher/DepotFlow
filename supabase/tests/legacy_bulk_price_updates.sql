-- Rollback-only checks for the original-shop bulk price RPC boundary.
begin;
do $price_rpc_boundary$
declare
  v_definition text;
  v_is_security_definer boolean;
begin
  select pg_catalog.pg_get_functiondef(p.oid),p.prosecdef
    into v_definition,v_is_security_definer
  from pg_catalog.pg_proc p
  where p.oid='public.update_legacy_product_prices(uuid,jsonb)'::regprocedure;
  if v_definition is null or v_is_security_definer is distinct from true then
    raise exception 'Price update RPC must exist as SECURITY DEFINER';
  end if;
  if pg_catalog.strpos(v_definition,'private.assert_legacy_assortment_owner()')=0
     or pg_catalog.strpos(v_definition,'p.business_id=v_business')=0
     or pg_catalog.strpos(v_definition,'h.business_id is not distinct from v_product.business_id')=0
     or pg_catalog.strpos(v_definition,'h.owner_user_id=v_actor')=0 then
    raise exception 'Price update RPC is missing legacy-owner or per-business write/read barriers';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.update_legacy_product_prices(uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Authenticated role cannot reach the owner-guarded price RPC';
  end if;
  if has_function_privilege(
    'anon',
    'public.update_legacy_product_prices(uuid,jsonb)',
    'EXECUTE'
  ) then
    raise exception 'Anonymous price RPC execution must remain denied';
  end if;
  if has_any_column_privilege(
    'authenticated','private.legacy_price_update_requests','SELECT'
  ) or has_any_column_privilege(
    'authenticated','private.legacy_price_update_requests','INSERT'
  ) then
    raise exception 'Private price request audit leaked direct access';
  end if;
end;
$price_rpc_boundary$;

set local role authenticated;
select set_config('request.jwt.claim.sub','',true);
do $anonymous_session$
begin
  begin
    perform public.update_legacy_product_prices(
      'b8c00000-0000-4000-8000-000000000001',
      '[{"product_id":"b8c00000-0000-4000-8000-000000000002","change_selling":true,"change_cost":false,"expected_full_crate_price":10000,"new_full_crate_price":10500,"expected_bottle_price":null,"new_bottle_price":null,"catalogue_product_id":null,"expected_cost_price":null,"new_cost_price":null}]'::jsonb
    );
    raise exception 'Unauthenticated request unexpectedly updated prices'
      using errcode='PT001';
  exception when insufficient_privilege then
    null;
  end;
end;
$anonymous_session$;
reset role;
rollback;
