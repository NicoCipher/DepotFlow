-- M2f-11: the original shop's SECURITY DEFINER sale routine must not
-- inspect another tenant's product metadata, branded crate identity, stock
-- quantity or stock request before checking its business identity.
-- The already-scoped replay/customer query remains unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $sale_inventory_read_scope$
declare
  v_oid oid := 'private.save_sale_v2(uuid,uuid,date,numeric,jsonb,jsonb,jsonb)'::regprocedure;
  v_source text;
  v_step record;
  v_matches integer;
  v_total integer:=0;
begin
  v_source:=pg_catalog.pg_get_functiondef(v_oid);
  if v_source is null
     or pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
     or pg_catalog.strpos(v_source,
       'request_id=p_request_id and private.can_read_legacy_customer(business_id)')=0
     or pg_catalog.strpos(v_source,
       'id=p_customer_id and private.can_read_legacy_customer(business_id)')=0 then
    raise exception 'Base sale authorization/replay prerequisite missing';
  end if;
  for v_step in select * from (values
    (
      $old$select * into v_actual_crate from public.crate_types
    where id=(v_return->>'crateTypeId')::uuid for share;$old$,
      $new$select * into v_actual_crate from public.crate_types
    where id=(v_return->>'crateTypeId')::uuid
      and private.can_read_legacy_customer(business_id) for share;$new$,1
    ),
    (
      $old$select 1 from public.products
      where bottles_returnable and bottle_type=v_actual_bottle_type$old$,
      $new$select 1 from public.products
      where bottles_returnable and bottle_type=v_actual_bottle_type
        and private.can_read_legacy_customer(business_id)$new$,1
    ),
    (
      $old$from public.products p
    where p.id in (select (x->>'productId')::uuid from jsonb_array_elements(p_lines) x)$old$,
      $new$from public.products p
    where private.can_read_legacy_customer(p.business_id)
      and p.id in (select (x->>'productId')::uuid from jsonb_array_elements(p_lines) x)$new$,1
    ),
    (
      $old$from public.stock s where s.product_id in (select (x->>'productId')::uuid from jsonb_array_elements(p_lines) x) order by s.product_id for update$old$,
      $new$from public.stock s where private.can_read_legacy_customer(s.business_id)
        and s.product_id in (select (x->>'productId')::uuid from jsonb_array_elements(p_lines) x) order by s.product_id for update$new$,1
    ),
    (
      $old$select * into v_product from public.products where id=(v_line->>'productId')::uuid;$old$,
      $new$select * into v_product from public.products where id=(v_line->>'productId')::uuid
      and private.can_read_legacy_customer(business_id);$new$,2
    ),
    (
      $old$select * into v_crate from public.crate_types where id=v_product.crate_type_id for share;$old$,
      $new$select * into v_crate from public.crate_types where id=v_product.crate_type_id
      and private.can_read_legacy_customer(business_id) for share;$new$,1
    ),
    (
      $old$select total_bottles into v_stock from public.stock where product_id=v_product.id for update;$old$,
      $new$select total_bottles into v_stock from public.stock where product_id=v_product.id
      and private.can_read_legacy_customer(business_id) for update;$new$,1
    ),
    (
      $old$update public.stock set total_bottles=total_bottles-v_bottles where product_id=v_product.id returning total_bottles into v_stock;$old$,
      $new$update public.stock set total_bottles=total_bottles-v_bottles where product_id=v_product.id
      and private.can_read_legacy_customer(business_id)
      returning total_bottles into v_stock;$new$,1
    ),
    (
      $old$select name into v_return_name from public.crate_types where id=(v_choice->>'returnedType')::uuid;$old$,
      $new$select name into v_return_name from public.crate_types where id=(v_choice->>'returnedType')::uuid
        and private.can_read_legacy_customer(business_id);$new$,1
    ),
    (
      $old$select name into v_owed_name from public.crate_types where id=v_product.crate_type_id;$old$,
      $new$select name into v_owed_name from public.crate_types where id=v_product.crate_type_id
        and private.can_read_legacy_customer(business_id);$new$,1
    ),
    (
      $old$select * into v_actual_crate from public.crate_types
      where id=(v_return->>'crateTypeId')::uuid;$old$,
      $new$select * into v_actual_crate from public.crate_types
      where id=(v_return->>'crateTypeId')::uuid
        and private.can_read_legacy_customer(business_id);$new$,1
    ),
    (
      $old$from public.stock_movements where request_id=p_request_id$old$,
      $new$from public.stock_movements where request_id=p_request_id
        and private.can_read_legacy_customer(business_id)$new$,1
    ),
    (
      $old$from private.stock_receipts where request_id=p_request_id$old$,
      $new$from private.stock_receipts where request_id=p_request_id
        and private.can_read_legacy_customer(business_id)$new$,1
    )
  ) a(old_text,new_text,expected_hits)
  loop
    v_matches := (length(v_source)-length(replace(v_source,v_step.old_text,'')))
        /length(v_step.old_text);
    if v_matches<>v_step.expected_hits then
      raise exception 'Base sale inventory SQL drift on % (got %, expected %)',
        pg_catalog.left(v_step.old_text,72),v_matches,v_step.expected_hits;
    end if;
    v_source:=replace(v_source,v_step.old_text,v_step.new_text);
    v_total:=v_total+v_matches;
  end loop;
  if v_total<>14 then
    raise exception 'Expected 14 verified inventory query rewrites, found %',v_total;
  end if;
  execute v_source;
end;
$sale_inventory_read_scope$;
commit;
