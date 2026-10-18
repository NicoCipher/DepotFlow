-- M2f-15: close privileged legacy sale + old-debt wrapper lookups.
-- Required before globally-unique sales/payment requests can be converted
-- to independently unique (business_id,request_id) pairs.
-- Draft-only: does not change financial keys or enable another shop.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $scope_original_sale_wrapper$
declare
  v_source text;
  v_oid oid:='public.save_sale_v2(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,text)'::regprocedure;
  r record;
  v_hits int;
begin
  select pg_catalog.pg_get_functiondef(v_oid) into v_source;
  if v_source is null
     or pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
     or pg_catalog.strpos(v_source,'private.can_read_legacy_customer(')<>0 then
    raise exception 'Single-method sale wrapper scope drift';
  end if;
  for r in select * from (values
    (
      $old$from public.customers where id = p_customer_id for update;$old$,
      $new$from public.customers where id = p_customer_id
        and private.can_read_legacy_customer(business_id) for update;$new$
    ),
    (
      $old$from public.money_owed where customer_id = p_customer_id for update;$old$,
      $new$from public.money_owed where customer_id = p_customer_id
        and private.can_read_legacy_customer(business_id) for update;$new$
    ),
    (
      $old$from public.sales where request_id=p_request_id for update;$old$,
      $new$from public.sales where request_id=p_request_id
        and private.can_read_legacy_customer(business_id) for update;$new$
    ),
    (
      $old$where request_id=p_request_id and payment_method='not_recorded';$old$,
      $new$where request_id=p_request_id and payment_method='not_recorded'
        and private.can_read_legacy_customer(business_id);$new$
    )
  ) a(old_text,new_text) loop
    v_hits:=(length(v_source)-length(replace(v_source,r.old_text,'')))
      /length(r.old_text);
    if v_hits<>1 then
      raise exception 'Original sale wrapper lookup drift: % (hits %)',
        pg_catalog.left(r.old_text,95),v_hits;
    end if;
    v_source:=replace(v_source,r.old_text,r.new_text);
  end loop;
  execute v_source;
end;
$scope_original_sale_wrapper$;

do $scope_old_debt_sale_wrapper$
declare
  v_source text;
  v_oid oid:='public.save_sale_with_old_debt_payment(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,text,numeric)'::regprocedure;
  r record;
  v_hits int;
begin
  select pg_catalog.pg_get_functiondef(v_oid) into v_source;
  if v_source is null
     or pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
     or pg_catalog.strpos(v_source,'private.can_read_legacy_customer(')<>0 then
    raise exception 'Old-debt sale wrapper scope drift';
  end if;
  for r in select * from (values
    (
      $old$from public.sales where request_id = p_request_id;$old$,
      $new$from public.sales where request_id = p_request_id
        and private.can_read_legacy_customer(business_id);$new$
    ),
    (
      $old$from public.customers where id = p_customer_id for update;$old$,
      $new$from public.customers where id = p_customer_id
        and private.can_read_legacy_customer(business_id) for update;$new$
    ),
    (
      $old$from public.money_owed
    where customer_id = p_customer_id for update;$old$,
      $new$from public.money_owed
    where customer_id = p_customer_id
      and private.can_read_legacy_customer(business_id) for update;$new$
    ),
    (
      $old$from public.sales where request_id = p_request_id)$old$,
      $new$from public.sales where request_id = p_request_id
         and private.can_read_legacy_customer(business_id))$new$
    ),
    (
      $old$from public.customer_payments where request_id = v_payment_request_id)$old$,
      $new$from public.customer_payments where request_id = v_payment_request_id
         and private.can_read_legacy_customer(business_id))$new$
    ),
    (
      $old$from public.sales
      where id = (v_sale_result->>'id')::uuid for update;$old$,
      $new$from public.sales
      where id = (v_sale_result->>'id')::uuid
        and private.can_read_legacy_customer(business_id) for update;$new$
    ),
    (
      $old$and payment_method = 'not_recorded';$old$,
      $new$and payment_method = 'not_recorded'
         and private.can_read_legacy_customer(business_id);$new$
    ),
    (
      $old$from public.money_owed where customer_id = p_customer_id;$old$,
      $new$from public.money_owed where customer_id = p_customer_id
        and private.can_read_legacy_customer(business_id);$new$
    ),
    (
      $old$from public.customer_payments where request_id = v_payment_request_id;$old$,
      $new$from public.customer_payments where request_id = v_payment_request_id
           and private.can_read_legacy_customer(business_id);$new$
    ),
    (
      $old$where id = (v_sale_result->>'id')::uuid and account_receipt is null;$old$,
      $new$where id = (v_sale_result->>'id')::uuid and account_receipt is null
        and private.can_read_legacy_customer(business_id);$new$
    )
  ) a(old_text,new_text) loop
    v_hits:=(length(v_source)-length(replace(v_source,r.old_text,'')))
      /length(r.old_text);
    if v_hits<>(case when r.old_text=
      'from public.customer_payments where request_id = v_payment_request_id)'
      then 2 else 1 end) then
      raise exception 'Old-debt wrapper lookup drift: % (hits %)',
        pg_catalog.left(r.old_text,100),v_hits;
    end if;
    v_source:=replace(v_source,r.old_text,r.new_text);
  end loop;
  execute v_source;
end;
$scope_old_debt_sale_wrapper$;

commit;
