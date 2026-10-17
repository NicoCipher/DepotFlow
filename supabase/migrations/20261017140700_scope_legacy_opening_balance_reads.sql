-- M2f-12: prevent SECURITY DEFINER opening balance replays and
-- crate/bottle references from crossing the original business boundary.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $scope_opening_balance_reads$
declare
  v_oid oid := 'private.record_opening_balances(uuid,uuid,numeric,date,text,jsonb,jsonb)'::regprocedure;
  v_source text;
  v_change record;
  v_hits integer;
  v_total integer:=0;
begin
  v_source:=pg_catalog.pg_get_functiondef(v_oid);
  if v_source is null or
     pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0 or
     pg_catalog.strpos(v_source,'private.can_read_legacy_customer(')<>0 then
    raise exception 'Opening-balance actor guard/source changed; manual review';
  end if;

  for v_change in select * from (values
    (
      $old$select * into v_existing from public.customer_opening_balances where request_id=p_request_id;$old$,
      $new$select * into v_existing from public.customer_opening_balances
        where request_id=p_request_id and private.can_read_legacy_customer(business_id);$new$,1
    ),
    (
      $old$select * into v_customer from public.customers where id=p_customer_id for update;$old$,
      $new$select * into v_customer from public.customers where id=p_customer_id
        and private.can_read_legacy_customer(business_id) for update;$new$,1
    ),
    (
      $old$from public.customer_opening_balances where customer_id=p_customer_id)$old$,
      $new$from public.customer_opening_balances where customer_id=p_customer_id
        and private.can_read_legacy_customer(business_id))$new$,1
    ),
    (
      $old$select * into v_crate from public.crate_types where id=(v_row->>'type')::uuid for key share;$old$,
      $new$select * into v_crate from public.crate_types where id=(v_row->>'type')::uuid
        and private.can_read_legacy_customer(business_id) for key share;$new$,1
    ),
    (
      $old$from public.products where bottles_returnable and bottle_type=v_row->>'type'$old$,
      $new$from public.products where bottles_returnable and bottle_type=v_row->>'type'
        and private.can_read_legacy_customer(business_id)$new$,1
    ),
    (
      $old$from public.bottle_obligations where bottle_type=v_row->>'type'$old$,
      $new$from public.bottle_obligations where bottle_type=v_row->>'type'
        and private.can_read_legacy_customer(business_id)$new$,1
    )
  ) a(old_text,new_text,expected_hits)
  loop
    v_hits:=(length(v_source)-length(replace(v_source,v_change.old_text,'')))
       /length(v_change.old_text);
    if v_hits<>v_change.expected_hits then
      raise exception 'Opening balance scope source drift: %, got %',
        pg_catalog.left(v_change.old_text,90),v_hits;
    end if;
    v_source:=replace(v_source,v_change.old_text,v_change.new_text);
    v_total:=v_total+v_hits;
  end loop;
  if v_total<>6 then raise exception 'Expected six scoped opening balance lookups';end if;
  execute v_source;
end;
$scope_opening_balance_reads$;
commit;
