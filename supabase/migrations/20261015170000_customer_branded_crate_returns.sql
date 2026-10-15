begin;

-- Keep old exact-return requests valid, while supporting explicit directional
-- branded substitutions without merging stock identities or creating another ledger.
create or replace function private.record_customer_empty_return(p_request_id uuid,p_customer_id uuid,p_crates jsonb,p_bottles jsonb,p_release_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare payload jsonb; previous jsonb; item jsonb; quantity integer; owed integer; label text; held uuid; changed integer;
declare v_owed_type uuid; v_actual_type uuid; v_owed_crate public.crate_types%rowtype; v_actual_crate public.crate_types%rowtype;
begin
  if auth.uid() is null or not public.is_shop_owner() then raise exception using errcode='42501',message='Owner only'; end if;
  if p_request_id is null or p_customer_id is null or jsonb_typeof(p_crates) is distinct from 'array' or jsonb_typeof(p_bottles) is distinct from 'array' or jsonb_array_length(p_crates)>1000 or jsonb_array_length(p_bottles)>1000 or p_release_ids is null or cardinality(p_release_ids)>1000 then raise exception using errcode='22023',message='Check the returned empties.'; end if;
  payload:=jsonb_build_object('customer',p_customer_id,'crates',p_crates,'bottles',p_bottles,'released',to_jsonb(p_release_ids));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  select request_payload into previous from private.customer_empty_returns where request_id=p_request_id;
  if found then
    if previous is distinct from payload then raise exception using errcode='22023',message='This return request was already used with different details.'; end if;
    return;
  end if;
  perform 1 from public.customers where id=p_customer_id for share;
  if not found then raise exception using errcode='22023',message='Customer no longer exists.'; end if;
  if exists(select 1 from jsonb_array_elements(p_crates) x group by x->>'crateTypeId',coalesce(x->>'returnedCrateTypeId',x->>'crateTypeId') having count(*)>1) or exists(select 1 from jsonb_array_elements(p_bottles) x group by x->>'bottleType' having count(*)>1) then raise exception using errcode='22023',message='Check the returned empties.'; end if;
  -- Both IDs are kept in the idempotent request payload. A crate owed is
  -- not necessarily the physical branded crate received into depot stock.
  for item in select value from jsonb_array_elements(p_crates)
    order by value->>'crateTypeId',coalesce(value->>'returnedCrateTypeId',value->>'crateTypeId') loop
    if coalesce(item->>'crateTypeId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
  for item in select value from jsonb_array_elements(p_bottles) order by value->>'bottleType' loop
    if nullif(item->>'bottleType','') is null or coalesce(item->>'quantity','') !~ '^[1-9][0-9]{0,8}$' then raise exception using errcode='22023',message='Check the returned empties.'; end if;
    quantity:=(item->>'quantity')::integer;
    select public.bottle_obligations.quantity into owed from public.bottle_obligations where customer_id=p_customer_id and bottle_type=item->>'bottleType' for update;
    if not found or quantity>owed then raise exception using errcode='22023',message='More bottles were entered than this customer owes. Check the counts.'; end if;
    update public.bottle_obligations set quantity=public.bottle_obligations.quantity-(item->>'quantity')::integer where customer_id=p_customer_id and bottle_type=item->>'bottleType';
    insert into public.empty_bottle_stock(bottle_type,quantity) values(item->>'bottleType',(item->>'quantity')::integer)
      on conflict(bottle_type) do update set quantity=public.empty_bottle_stock.quantity+excluded.quantity;
  end loop;
  foreach held in array p_release_ids loop
    update public.sale_empty_decisions set released_at=now() where id=held and customer_id=p_customer_id and decision='hold' and released_at is null;
    get diagnostics changed = row_count;
    if changed<>1 then raise exception using errcode='22023',message='These held empties were already collected. Check the customer.'; end if;
  end loop;
  if jsonb_array_length(p_crates)+jsonb_array_length(p_bottles)+cardinality(p_release_ids)=0 then raise exception using errcode='22023',message='Enter what came back.'; end if;
  insert into private.customer_empty_returns(request_id,customer_id,request_payload) values(p_request_id,p_customer_id,payload);
end;
$$;

      or coalesce(item->>'returnedCrateTypeId',item->>'crateTypeId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
  for item in select value from jsonb_array_elements(p_bottles) order by value->>'bottleType' loop
    if nullif(item->>'bottleType','') is null or coalesce(item->>'quantity','') !~ '^[1-9][0-9]{0,8}$' then raise exception using errcode='22023',message='Check the returned empties.'; end if;
    quantity:=(item->>'quantity')::integer;
    select public.bottle_obligations.quantity into owed from public.bottle_obligations where customer_id=p_customer_id and bottle_type=item->>'bottleType' for update;
    if not found or quantity>owed then raise exception using errcode='22023',message='More bottles were entered than this customer owes. Check the counts.'; end if;
    update public.bottle_obligations set quantity=public.bottle_obligations.quantity-(item->>'quantity')::integer where customer_id=p_customer_id and bottle_type=item->>'bottleType';
    insert into public.empty_bottle_stock(bottle_type,quantity) values(item->>'bottleType',(item->>'quantity')::integer)
      on conflict(bottle_type) do update set quantity=public.empty_bottle_stock.quantity+excluded.quantity;
  end loop;
  foreach held in array p_release_ids loop
    update public.sale_empty_decisions set released_at=now() where id=held and customer_id=p_customer_id and decision='hold' and released_at is null;
    get diagnostics changed = row_count;
    if changed<>1 then raise exception using errcode='22023',message='These held empties were already collected. Check the customer.'; end if;
  end loop;
  if jsonb_array_length(p_crates)+jsonb_array_length(p_bottles)+cardinality(p_release_ids)=0 then raise exception using errcode='22023',message='Enter what came back.'; end if;
  insert into private.customer_empty_returns(request_id,customer_id,request_payload) values(p_request_id,p_customer_id,payload);
end;
$$;

      or coalesce(item->>'quantity','') !~ '^[1-9][0-9]{0,8}
  for item in select value from jsonb_array_elements(p_bottles) order by value->>'bottleType' loop
    if nullif(item->>'bottleType','') is null or coalesce(item->>'quantity','') !~ '^[1-9][0-9]{0,8}$' then raise exception using errcode='22023',message='Check the returned empties.'; end if;
    quantity:=(item->>'quantity')::integer;
    select public.bottle_obligations.quantity into owed from public.bottle_obligations where customer_id=p_customer_id and bottle_type=item->>'bottleType' for update;
    if not found or quantity>owed then raise exception using errcode='22023',message='More bottles were entered than this customer owes. Check the counts.'; end if;
    update public.bottle_obligations set quantity=public.bottle_obligations.quantity-(item->>'quantity')::integer where customer_id=p_customer_id and bottle_type=item->>'bottleType';
    insert into public.empty_bottle_stock(bottle_type,quantity) values(item->>'bottleType',(item->>'quantity')::integer)
      on conflict(bottle_type) do update set quantity=public.empty_bottle_stock.quantity+excluded.quantity;
  end loop;
  foreach held in array p_release_ids loop
    update public.sale_empty_decisions set released_at=now() where id=held and customer_id=p_customer_id and decision='hold' and released_at is null;
    get diagnostics changed = row_count;
    if changed<>1 then raise exception using errcode='22023',message='These held empties were already collected. Check the customer.'; end if;
  end loop;
  if jsonb_array_length(p_crates)+jsonb_array_length(p_bottles)+cardinality(p_release_ids)=0 then raise exception using errcode='22023',message='Enter what came back.'; end if;
  insert into private.customer_empty_returns(request_id,customer_id,request_payload) values(p_request_id,p_customer_id,payload);
end;
$$;

    then raise exception using errcode='22023',message='Check the returned empties.'; end if;
    quantity:=(item->>'quantity')::integer;
    v_owed_type:=(item->>'crateTypeId')::uuid;
    v_actual_type:=coalesce(nullif(item->>'returnedCrateTypeId',''),item->>'crateTypeId')::uuid;
    select * into v_owed_crate from public.crate_types where id=v_owed_type for key share;
    if not found then raise exception using errcode='22023',message='Unknown owed crate type.'; end if;
    select * into v_actual_crate from public.crate_types where id=v_actual_type for key share;
    if not found then raise exception using errcode='22023',message='Unknown returned crate type.'; end if;
    if v_owed_type<>v_actual_type then
      if v_owed_crate.is_legacy or v_actual_crate.is_legacy or v_owed_crate.pocket_count is null
        or v_owed_crate.pocket_count is distinct from v_actual_crate.pocket_count then
        raise exception using errcode='22023',message='The replacement crate is not compatible.'; end if;
      -- A swap is allowed only when explicitly configured, not because the
      -- brewery or number of pockets happens to match.
      perform 1 from public.crate_swap_rules
        where owed_crate_type_id=v_owed_type and returned_crate_type_id=v_actual_type for share;
      if not found then raise exception using errcode='22023',message='The replacement crate is not approved.'; end if;
    end if;
    select public.crate_obligations.quantity into owed from public.crate_obligations
      where customer_id=p_customer_id and crate_type_id=v_owed_type for update;
    if not found or quantity>owed then
      raise exception using errcode='22023',message='More crates were entered than this customer owes. Check the counts.'; end if;
    update public.crate_obligations
      set quantity=public.crate_obligations.quantity-(item->>'quantity')::integer
      where customer_id=p_customer_id and crate_type_id=v_owed_type;
    insert into public.empty_crate_stock(crate_type_id,crate_type,quantity)
      values(v_actual_type,v_actual_crate.name,quantity)
      on conflict(crate_type_id) do update
        set quantity=public.empty_crate_stock.quantity+excluded.quantity,
            crate_type=excluded.crate_type;
  end loop;
  for item in select value from jsonb_array_elements(p_bottles) order by value->>'bottleType' loop
    if nullif(item->>'bottleType','') is null or coalesce(item->>'quantity','') !~ '^[1-9][0-9]{0,8}$' then raise exception using errcode='22023',message='Check the returned empties.'; end if;
    quantity:=(item->>'quantity')::integer;
    select public.bottle_obligations.quantity into owed from public.bottle_obligations where customer_id=p_customer_id and bottle_type=item->>'bottleType' for update;
    if not found or quantity>owed then raise exception using errcode='22023',message='More bottles were entered than this customer owes. Check the counts.'; end if;
    update public.bottle_obligations set quantity=public.bottle_obligations.quantity-(item->>'quantity')::integer where customer_id=p_customer_id and bottle_type=item->>'bottleType';
    insert into public.empty_bottle_stock(bottle_type,quantity) values(item->>'bottleType',(item->>'quantity')::integer)
      on conflict(bottle_type) do update set quantity=public.empty_bottle_stock.quantity+excluded.quantity;
  end loop;
  foreach held in array p_release_ids loop
    update public.sale_empty_decisions set released_at=now() where id=held and customer_id=p_customer_id and decision='hold' and released_at is null;
    get diagnostics changed = row_count;
    if changed<>1 then raise exception using errcode='22023',message='These held empties were already collected. Check the customer.'; end if;
  end loop;
  if jsonb_array_length(p_crates)+jsonb_array_length(p_bottles)+cardinality(p_release_ids)=0 then raise exception using errcode='22023',message='Enter what came back.'; end if;
  insert into private.customer_empty_returns(request_id,customer_id,request_payload) values(p_request_id,p_customer_id,payload);
end;
$$;

-- Preserve the physical brand and the different obligation it settled in return history.
create or replace function public.customer_return_record(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $return$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(
    select 1 from private.shop_owner where user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  select jsonb_build_object(
    'id',r.request_id,'customer_id',r.customer_id,
    'customer_name',c.name,'business_name',c.business_name,'created_at',r.created_at,
    'crates',coalesce((select jsonb_agg(jsonb_build_object(
      'name',coalesce(actual.name,'Crate'),
      'owed_name',case when actual.id is distinct from owed.id then owed.name else null end,
      'quantity',(x.value->>'quantity')::integer))
      from jsonb_array_elements(coalesce(r.request_payload->'crates','[]'::jsonb)) x(value)
      left join public.crate_types owed on owed.id=(x.value->>'crateTypeId')::uuid
      left join public.crate_types actual on actual.id=coalesce(
        nullif(x.value->>'returnedCrateTypeId','')::uuid,(x.value->>'crateTypeId')::uuid)),'[]'::jsonb),
    'bottles',coalesce((select jsonb_agg(jsonb_build_object(
      'name',x.value->>'bottleType','quantity',(x.value->>'quantity')::integer))
      from jsonb_array_elements(coalesce(r.request_payload->'bottles','[]'::jsonb)) x(value)),'[]'::jsonb),
    'released',coalesce((select jsonb_agg(jsonb_build_object(
      'name',d.returned_name,'kind',d.kind,'quantity',d.quantity))
      from jsonb_array_elements_text(coalesce(r.request_payload->'released','[]'::jsonb)) e(id)
      join public.sale_empty_decisions d on d.id=e.id::uuid and d.customer_id=r.customer_id),'[]'::jsonb)
  ) into v_result
  from private.customer_empty_returns r join public.customers c on c.id=r.customer_id
  where r.request_id=p_id;
  return v_result;
end $return$;


commit;
