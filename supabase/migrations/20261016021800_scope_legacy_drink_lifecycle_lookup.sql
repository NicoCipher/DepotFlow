-- M2f-3b: the privileged legacy drink lifecycle RPC must not report
-- a foreign product's existence or active status, even on an idempotent retry.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $scope_drink_lookup$
declare
  v_oid oid:='public.set_shop_drink_active(uuid,boolean,boolean)'::regprocedure;
  v_source text;
  v_old constant text:='from public.products where id=p_id for update;';
  v_new constant text:='from public.products where id=p_id and private.can_read_legacy_customer(business_id) for update;';
  v_count integer;
begin
  select pg_catalog.pg_get_functiondef(v_oid) into v_source;
  if v_source is null
    or pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
    or pg_catalog.strpos(v_source,v_new)<>0 then
    raise exception 'Drink lifecycle authorization changed; manual review required';
  end if;
  v_count:=(length(v_source)-length(replace(v_source,v_old,'')))
      / length(v_old);
  if v_count<>1 then
    raise exception 'Expected exactly one scoped product lookup, found %',v_count;
  end if;
  execute replace(v_source,v_old,v_new);
end;
$scope_drink_lookup$;
commit;
