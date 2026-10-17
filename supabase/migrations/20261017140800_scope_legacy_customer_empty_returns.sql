-- M2f-13: close customer-empty-return SECURITY DEFINER oracles.
-- The legacy owner may only inspect its OWN customer, owed/actual branded
-- crates, empty obligations, held decisions and idempotent return requests.
-- This does not create a new-business returns writer or enable onboarding.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $scope_old_shop_empty_returns$
declare
  v_oid oid := 'private.record_customer_empty_return(uuid,uuid,jsonb,jsonb,uuid[])'::regprocedure;
  v_source text;
  v_change record;
  v_hits int;
  v_total int:=0;
begin
  v_source:=pg_catalog.pg_get_functiondef(v_oid);
  if v_source is null
    or pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
    or pg_catalog.strpos(v_source,
       'on conflict(business_id,bottle_type) do update')=0
    or pg_catalog.strpos(v_source,'private.can_read_legacy_customer(')<>0 then
    raise exception 'Legacy branded-return source prerequisite drift: actor %, upsert %, alreadyScoped %',
      pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()'),
      pg_catalog.strpos(v_source,'on conflict(business_id,bottle_type) do update'),
      pg_catalog.strpos(v_source,'private.can_read_legacy_customer(');
  end if;

  for v_change in select * from (values
    (
      $old$from private.customer_empty_returns where request_id=p_request_id;$old$,
      $new$from private.customer_empty_returns where request_id=p_request_id
        and private.can_read_legacy_customer(business_id);$new$,1
    ),
    (
      $old$from public.customers where id=p_customer_id for share;$old$,
      $new$from public.customers where id=p_customer_id
        and private.can_read_legacy_customer(business_id) for share;$new$,1
    ),
    (
      $old$from public.crate_types where id=v_owed_type for key share;$old$,
      $new$from public.crate_types where id=v_owed_type
        and private.can_read_legacy_customer(business_id) for key share;$new$,1
    ),
    (
      $old$from public.crate_types where id=v_actual_type for key share;$old$,
      $new$from public.crate_types where id=v_actual_type
        and private.can_read_legacy_customer(business_id) for key share;$new$,1
    ),
    (
      $old$from public.crate_swap_rules where owed_crate_type_id=v_owed_type
        and returned_crate_type_id=v_actual_type for share;$old$,
      $new$from public.crate_swap_rules where owed_crate_type_id=v_owed_type
        and returned_crate_type_id=v_actual_type
        and private.can_read_legacy_customer(business_id) for share;$new$,1
    ),
    (
      $old$where customer_id=p_customer_id and crate_type_id=v_owed_type for update;$old$,
      $new$where customer_id=p_customer_id and crate_type_id=v_owed_type
        and private.can_read_legacy_customer(business_id) for update;$new$,1
    ),
    (
      $old$where customer_id=p_customer_id and crate_type_id=v_owed_type;$old$,
      $new$where customer_id=p_customer_id and crate_type_id=v_owed_type
        and private.can_read_legacy_customer(business_id);$new$,1
    ),
    (
      $old$from public.bottle_obligations where customer_id=p_customer_id and bottle_type=item->>'bottleType' for update;$old$,
      $new$from public.bottle_obligations where customer_id=p_customer_id and bottle_type=item->>'bottleType'
        and private.can_read_legacy_customer(business_id) for update;$new$,1
    ),
    (
      $old$where customer_id=p_customer_id and bottle_type=item->>'bottleType';$old$,
      $new$where customer_id=p_customer_id and bottle_type=item->>'bottleType'
        and private.can_read_legacy_customer(business_id);$new$,1
    ),
    (
      $old$where id=held and customer_id=p_customer_id and decision='hold' and released_at is null;$old$,
      $new$where id=held and customer_id=p_customer_id and decision='hold'
        and released_at is null and private.can_read_legacy_customer(business_id);$new$,1
    )
  ) a(old_text,new_text,expected_hits)
  loop
    v_hits:=(length(v_source)-length(replace(v_source,v_change.old_text,'')))
      /length(v_change.old_text);
    if v_hits<>v_change.expected_hits then
      raise exception 'Customer empty return source drift: %, hits %',
        pg_catalog.left(v_change.old_text,105),v_hits;
    end if;
    v_source:=replace(v_source,v_change.old_text,v_change.new_text);
    v_total:=v_total+v_hits;
  end loop;
  if v_total<>10 then
    raise exception 'Expected ten legacy empty-return scope edits: %',v_total;
  end if;
  execute v_source;
end;
$scope_old_shop_empty_returns$;
commit;
