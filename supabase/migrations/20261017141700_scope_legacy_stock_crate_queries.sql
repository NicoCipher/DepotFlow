-- M2f-22: legacy original-shop stock and exact crate operations must not
-- inspect another depot's product, stock, crate inventory or movement row.
-- Their privileges stay legacy-only; this is NOT new-business activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $scope_legacy_stock_metadata$
declare
  v_source text;
  v_oid oid;
  v_signature text;
  r record;
  v_hits int;
  v_count int:=0;
begin
  for v_signature in
    select unnest(array[
      'private.receive_stock(uuid,uuid,numeric,integer,integer,integer,uuid,date)',
      'private.set_current_stock(uuid,uuid,numeric,numeric,date,integer,integer)',
      'private.set_empty_crate_count(uuid,uuid,numeric,date,integer)'
    ])
  loop
    v_oid:=pg_catalog.to_regprocedure(v_signature);
    if v_oid is null then raise exception 'Missing legacy inventory RPC %',v_signature;end if;
    v_source:=pg_catalog.pg_get_functiondef(v_oid);
    if pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0 then
      raise exception 'Legacy inventory RPC lacks a verified original-shop owner guard: %',v_signature;
    end if;

    for r in
      select * from (values
      ('private.receive_stock(',
       $old$select * into v_product from public.products where id = p_product_id for update;$old$,
       $new$select * into v_product from public.products where id = p_product_id
         and private.can_read_legacy_customer(business_id) for update;$new$),
      ('private.receive_stock(',
       $old$select quantity into v_empties from public.empty_crate_stock
    where crate_type_id = v_product.crate_type_id for update;$old$,
       $new$select quantity into v_empties from public.empty_crate_stock
    where crate_type_id = v_product.crate_type_id
      and private.can_read_legacy_customer(business_id) for update;$new$),
      ('private.receive_stock(',
       $old$select total_bottles into v_stock from public.stock where product_id=p_product_id for update;$old$,
       $new$select total_bottles into v_stock from public.stock where product_id=p_product_id
         and private.can_read_legacy_customer(business_id) for update;$new$),
      ('private.receive_stock(',
       $old$update public.empty_crate_stock set quantity=quantity-p_crates::integer
    where crate_type_id=v_product.crate_type_id;$old$,
       $new$update public.empty_crate_stock set quantity=quantity-p_crates::integer
    where crate_type_id=v_product.crate_type_id
      and private.can_read_legacy_customer(business_id);$new$),
      ('private.receive_stock(',
       $old$update public.stock set total_bottles=total_bottles+v_added::integer where product_id=p_product_id;$old$,
       $new$update public.stock set total_bottles=total_bottles+v_added::integer where product_id=p_product_id
         and private.can_read_legacy_customer(business_id);$new$),
      ('private.set_current_stock(',
       $old$select * into v_product from public.products where id=p_product_id for update;$old$,
       $new$select * into v_product from public.products where id=p_product_id
         and private.can_read_legacy_customer(business_id) for update;$new$),
      ('private.set_current_stock(',
       $old$select total_bottles into v_stock from public.stock where product_id=p_product_id for update;$old$,
       $new$select total_bottles into v_stock from public.stock where product_id=p_product_id
         and private.can_read_legacy_customer(business_id) for update;$new$),
      ('private.set_current_stock(',
       $old$update public.stock set total_bottles=v_total::integer where product_id=p_product_id;$old$,
       $new$update public.stock set total_bottles=v_total::integer where product_id=p_product_id
         and private.can_read_legacy_customer(business_id);$new$),
      ('private.set_empty_crate_count(',
       $old$select * into v_movement from public.empty_crate_movements where request_id=p_request_id;$old$,
       $new$select * into v_movement from public.empty_crate_movements where request_id=p_request_id
         and private.can_read_legacy_customer(business_id);$new$),
      ('private.set_empty_crate_count(',
       $old$if not exists(select 1 from public.crate_types where id=p_crate_type_id) then$old$,
       $new$if not exists(select 1 from public.crate_types where id=p_crate_type_id
         and private.can_read_legacy_customer(business_id)) then$new$),
      ('private.set_empty_crate_count(',
       $old$select quantity into v_quantity from public.empty_crate_stock where crate_type_id=p_crate_type_id for update;$old$,
       $new$select quantity into v_quantity from public.empty_crate_stock where crate_type_id=p_crate_type_id
         and private.can_read_legacy_customer(business_id) for update;$new$),
      ('private.set_empty_crate_count(',
       $old$update public.empty_crate_stock set quantity=p_quantity::integer where crate_type_id=p_crate_type_id;$old$,
       $new$update public.empty_crate_stock set quantity=p_quantity::integer where crate_type_id=p_crate_type_id
         and private.can_read_legacy_customer(business_id);$new$)
      ) a(name_prefix,old_text,new_text)
      where pg_catalog.strpos(v_signature,a.name_prefix)=1
    loop
      v_hits:=(length(v_source)-length(replace(v_source,r.old_text,'')))
        /length(r.old_text);
      if v_hits<>1 then
        raise exception 'Legacy inventory source drift: % / % matches %',
          v_signature,pg_catalog.left(r.old_text,72),v_hits;
      end if;
      v_source:=replace(v_source,r.old_text,r.new_text);
      v_count:=v_count+v_hits;
    end loop;
    execute v_source;
  end loop;
  if v_count<>12 then
    raise exception 'Expected twelve independently reviewed inventory predicates, got %',v_count;
  end if;
end;
$scope_legacy_stock_metadata$;

-- A future depot's count may reuse an old-shop movement request UUID.
-- Existing crate movement IDs and original-client UUIDs never change.
do $crate_movement_request_preflight$
declare v_key text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into v_key
  from pg_catalog.pg_constraint
  where conrelid='public.empty_crate_movements'::regclass
    and conname='empty_crate_movements_request_id_key' and contype='u';
  if v_key is distinct from 'UNIQUE (request_id)' then
    raise exception 'Unexpected exact-crate movement idempotency identity: %',v_key;
  end if;
end;
$crate_movement_request_preflight$;
alter table public.empty_crate_movements
 drop constraint empty_crate_movements_request_id_key;
alter table public.empty_crate_movements
 add constraint empty_crate_movements_business_request_unique
 unique nulls not distinct (business_id,request_id);

commit;
