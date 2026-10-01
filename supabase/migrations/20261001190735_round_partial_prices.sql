-- Round the selected partial-crate quantity once to the next 50 naira.
CREATE OR REPLACE FUNCTION private.save_sale_v2(p_request_id uuid, p_customer_id uuid, p_business_date date, p_paid numeric, p_lines jsonb, p_returned_crates jsonb, p_returned_bottles jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sale public.sales%rowtype;
  v_customer public.customers%rowtype;
  v_product public.products%rowtype;
  v_crate public.crate_types%rowtype;
  v_line jsonb;
  v_choice jsonb;
  v_held integer;
  v_return_name text;
  v_owed_name text;
  v_stock integer;
  v_crates integer;
  v_crates_out integer;
  v_fraction integer;
  v_eighths integer;
  v_loose integer;
  v_bottles integer;
  v_return_crates integer;
  v_return_bottles integer;
  v_half_price numeric;
  v_quarter_price numeric;
  v_total integer := 0;
  v_line_total integer;
  v_payload jsonb;
  v_id uuid;
  v_count integer;
  v_expected jsonb;
  v_return jsonb;
  v_actual_crate public.crate_types%rowtype;
  v_actual_quantity integer;
  v_actual_bottle_type text;
  v_actual_crates_total numeric := 0;
  v_actual_bottles_total numeric := 0;
  v_settled_crates_total numeric := 0;
  v_settled_bottles_total numeric := 0;
  v_has_shortage boolean := false;
begin
  if auth.uid() is null or not exists(select 1 from private.shop_owner where user_id=auth.uid()) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_request_id is null or p_customer_id is null or p_business_date is null or p_paid is null
    or p_paid='NaN'::numeric or p_paid<0 or p_paid<>trunc(p_paid) or p_paid>2147483647
    or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 1000
    or jsonb_typeof(p_returned_crates) is distinct from 'array' or jsonb_array_length(p_returned_crates)>1000
    or jsonb_typeof(p_returned_bottles) is distinct from 'array' or jsonb_array_length(p_returned_bottles)>1000 then
    raise exception using errcode='22023',message='Check the sale details.';
  end if;
  v_payload:=jsonb_build_object(
    'customer',p_customer_id,'date',p_business_date,'paid',p_paid,'lines',p_lines,
    'returnedCrates',p_returned_crates,'returnedBottles',p_returned_bottles
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  select * into v_sale from public.sales where request_id=p_request_id;
  if found then
    if v_sale.request_payload is distinct from v_payload then
      raise exception using errcode='22023',message='This sale request was already used with different details.';
    end if;
    return jsonb_build_object('id',v_sale.id,'total',v_sale.total_amount,'paid',v_sale.paid_amount,'owing',v_sale.total_amount-v_sale.paid_amount,'customer',p_customer_id);
  end if;
  if exists(select 1 from public.stock_movements where request_id=p_request_id)
    or exists(select 1 from private.stock_receipts where request_id=p_request_id) then
    raise exception using errcode='22023',message='This request was already used for stock.';
  end if;
  -- FOR KEY SHARE (the prior lock strength) does not conflict with a plain
  -- UPDATE that leaves key columns alone, so archive/restore's UPDATE would
  -- have been free to commit mid-sale without this transaction noticing.
  -- FOR SHARE conflicts with that UPDATE's implicit FOR NO KEY UPDATE lock,
  -- so whichever of the sale or the archive/restore reaches this row first
  -- forces the other to wait for it to finish, and then see its outcome.
  select * into v_customer from public.customers where id=p_customer_id for share;
  if not found then raise exception using errcode='22023',message='Customer no longer exists. Review the sale.'; end if;
  if v_customer.archived_at is not null then
    raise exception using errcode='22023',message='This customer is archived. Restore them before recording a new sale.';
  end if;

  if exists(
    select 1 from jsonb_array_elements(p_returned_crates) x
    group by x->>'crateTypeId' having count(*)>1
  ) or exists(
    select 1 from jsonb_array_elements(p_returned_bottles) x
    group by x->>'bottleType' having count(*)>1
  ) then
    raise exception using errcode='22023',message='Returned empties contain duplicate types.';
  end if;

  for v_return in select value from jsonb_array_elements(p_returned_crates) loop
    if jsonb_typeof(v_return) is distinct from 'object'
      or coalesce((v_return->>'crateTypeId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',true)
      or coalesce((v_return->>'quantity') !~ '^\d{1,9}$',true) then
      raise exception using errcode='22023',message='Check the returned crates.';
    end if;
    v_actual_quantity:=(v_return->>'quantity')::integer;
    select * into v_actual_crate from public.crate_types
    where id=(v_return->>'crateTypeId')::uuid for share;
    if not found or v_actual_crate.is_legacy then
      raise exception using errcode='22023',message='A returned crate type is no longer available.';
    end if;
    v_actual_crates_total:=v_actual_crates_total+v_actual_quantity;
  end loop;

  for v_return in select value from jsonb_array_elements(p_returned_bottles) loop
    if jsonb_typeof(v_return) is distinct from 'object'
      or (v_return->>'bottleType') is null
      or length(btrim(v_return->>'bottleType')) not between 1 and 120
      or coalesce((v_return->>'quantity') !~ '^\d{1,9}$',true) then
      raise exception using errcode='22023',message='Check the returned bottles.';
    end if;
    v_actual_bottle_type:=btrim(v_return->>'bottleType');
    v_actual_quantity:=(v_return->>'quantity')::integer;
    if not exists(
      select 1 from public.products
      where bottles_returnable and bottle_type=v_actual_bottle_type
    ) then
      raise exception using errcode='22023',message='A returned bottle type is no longer available.';
    end if;
    v_actual_bottles_total:=v_actual_bottles_total+v_actual_quantity;
  end loop;
  for v_product in select p.* from public.products p
    where p.id in (select (x->>'productId')::uuid from jsonb_array_elements(p_lines) x)
    order by p.id for update
  loop
    null;
  end loop;
  for v_stock in select s.total_bottles from public.stock s where s.product_id in (select (x->>'productId')::uuid from jsonb_array_elements(p_lines) x) order by s.product_id for update loop null; end loop;
  select count(*) into v_count from (select distinct x->>'productId' from jsonb_array_elements(p_lines) x) ids;
  if v_count<>jsonb_array_length(p_lines) then raise exception using errcode='22023',message='Review duplicate drinks.'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line->'quantity') is distinct from 'object' or jsonb_typeof(v_line->'expected') is distinct from 'object'
      or (v_line->>'productId') is null then raise exception using errcode='22023',message='Check the sale details.'; end if;
    select * into v_product from public.products where id=(v_line->>'productId')::uuid;
    if not found then raise exception using errcode='22023',message='A drink no longer exists. Review the sale.'; end if;
    v_expected:=v_line->'expected';
    if (v_expected - 'stock') is distinct from jsonb_build_object(
      'full',v_product.full_crate_price,'half',v_product.half_crate_price,'quarter',v_product.quarter_crate_price,
      'bottle',v_product.bottle_price,'size',v_product.bottles_per_crate,'crate',v_product.crate_type_id,
      'returnable',v_product.bottles_returnable,'bottleType',v_product.bottle_type) then
      raise exception using errcode='22023',message='Price or product details changed. Review the sale.';
    end if;
    if coalesce((v_line->'quantity'->>'crates') !~ '^\d{1,9}$',true) or coalesce((v_line->'quantity'->>'fraction') !~ '^[0-3]$',true)
      or (v_line->'quantity' ? 'eighths' and coalesce((v_line->'quantity'->>'eighths') !~ '^[01357]$',true))
      or coalesce((v_line->'quantity'->>'bottles') !~ '^\d{1,9}$',true)
      or (v_line ? 'cratesTaken' and coalesce((v_line->>'cratesTaken') !~ '^\d{1,9}$',true))
      or coalesce((v_line->>'returnedCrates') !~ '^\d{1,9}$',true) or coalesce((v_line->>'returnedBottles') !~ '^\d{1,9}$',true) then
      raise exception using errcode='22023',message='Enter whole quantities of drinks and empties.';
    end if;
    v_crates:=(v_line->'quantity'->>'crates')::integer;
    v_fraction:=(v_line->'quantity'->>'fraction')::integer;
    v_eighths:=coalesce((v_line->'quantity'->>'eighths')::integer,0);
    if v_eighths>0 and (v_fraction<>0 or v_product.bottles_per_crate<>24) then
      raise exception using errcode='22023',message='Choose a valid 24-bottle quantity.';
    end if;
    v_loose:=(v_line->'quantity'->>'bottles')::integer;
    v_crates_out:=coalesce((v_line->>'cratesTaken')::integer,v_crates);
    v_return_crates:=(v_line->>'returnedCrates')::integer;
    v_return_bottles:=(v_line->>'returnedBottles')::integer;
    if (v_fraction::numeric*v_product.bottles_per_crate)%4<>0 then raise exception using errcode='22023',message='That fraction does not make whole bottles.'; end if;
    if v_crates::numeric*v_product.bottles_per_crate + (v_fraction::numeric*v_product.bottles_per_crate/4)::integer + v_eighths*3 + v_loose >2147483647 then
      raise exception using errcode='22023',message='That quantity is too large.'; end if;
    v_bottles:=v_crates*v_product.bottles_per_crate+(v_fraction::numeric*v_product.bottles_per_crate/4)::integer+v_eighths*3+v_loose;
    if v_bottles<1 or v_crates_out>v_crates or v_return_crates>v_crates_out
      or v_return_bottles>(case when v_product.bottles_returnable then v_bottles else 0 end) then
      raise exception using errcode='22023',message='Check returned empties.'; end if;
    v_settled_crates_total:=v_settled_crates_total+v_return_crates;
    v_settled_bottles_total:=v_settled_bottles_total+v_return_bottles;
    if v_crates_out>v_return_crates
      or (v_product.bottles_returnable and v_bottles>v_return_bottles) then
      v_has_shortage:=true;
    end if;
    if v_crates>0 then
      select * into v_crate from public.crate_types where id=v_product.crate_type_id for share;
      if not found or v_crate.is_legacy or v_crate.pocket_count is distinct from v_product.bottles_per_crate then
        raise exception using errcode='22023',message='Choose an exact crate type for this drink before saving.';
      end if;
    end if;
    if ((v_crates>0 or v_eighths>0) and v_product.full_crate_price is null)
      or (v_fraction>=2 and v_product.half_crate_price is null and v_product.full_crate_price is null)
      or (v_fraction%2=1 and v_product.quarter_crate_price is null and v_product.full_crate_price is null)
      or (v_loose>0 and v_product.bottle_price is null) then
      raise exception using errcode='22023',message='A price is missing. Review the sale.';
    end if;
    v_half_price:=coalesce(v_product.half_crate_price::numeric,v_product.full_crate_price::numeric/2);
    v_quarter_price:=coalesce(v_product.quarter_crate_price::numeric,v_product.full_crate_price::numeric/4);
    if v_crates::numeric*coalesce(v_product.full_crate_price,0)+ceil(((v_fraction/2)*coalesce(v_half_price,0)
      +(v_fraction%2)*coalesce(v_quarter_price,0)+v_eighths*coalesce(v_product.full_crate_price::numeric,0)/8)/50)*50+v_loose::numeric*coalesce(v_product.bottle_price,0)>2147483647 then
      raise exception using errcode='22023',message='Sale total is too large.'; end if;
    v_line_total:=v_crates::numeric*coalesce(v_product.full_crate_price,0)+ceil(((v_fraction/2)*coalesce(v_half_price,0)
      +(v_fraction%2)*coalesce(v_quarter_price,0)+v_eighths*coalesce(v_product.full_crate_price::numeric,0)/8)/50)*50+v_loose::numeric*coalesce(v_product.bottle_price,0);
    if v_line_total::numeric+v_total>2147483647 then raise exception using errcode='22023',message='Sale total is too large.'; end if;
    v_total:=v_total+v_line_total;
    select total_bottles into v_stock from public.stock where product_id=v_product.id for update;
    if not found or v_stock<v_bottles then raise exception using errcode='22023',message='Not enough stock. Review the sale.'; end if;
  end loop;
  if v_actual_crates_total<v_settled_crates_total
    or v_actual_bottles_total<v_settled_bottles_total then
    raise exception using errcode='22023',message='Returned empties cannot settle more than physically came back.';
  end if;
  if v_customer.empties_deposit_required and v_has_shortage then
    raise exception using errcode='22023',message='This customer requires an empties deposit. Deposit handling is not enabled for shortages yet.';
  end if;
  if p_paid>v_total then raise exception using errcode='22023',message='Amount paid cannot exceed the total.'; end if;
  perform private.check_sale_empty_choices(p_lines,p_returned_crates,p_returned_bottles);
  insert into public.sales(customer_id,total_amount,paid_amount,business_date,request_id,request_payload)
    values(p_customer_id,v_total,p_paid::integer,p_business_date,p_request_id,v_payload) returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id=(v_line->>'productId')::uuid;
    v_crates:=(v_line->'quantity'->>'crates')::integer;
    v_fraction:=(v_line->'quantity'->>'fraction')::integer;
    v_eighths:=coalesce((v_line->'quantity'->>'eighths')::integer,0);
    if v_eighths>0 and (v_fraction<>0 or v_product.bottles_per_crate<>24) then
      raise exception using errcode='22023',message='Choose a valid 24-bottle quantity.';
    end if;
    v_loose:=(v_line->'quantity'->>'bottles')::integer;
    v_crates_out:=coalesce((v_line->>'cratesTaken')::integer,v_crates);
    v_return_crates:=(v_line->>'returnedCrates')::integer;
    v_return_bottles:=(v_line->>'returnedBottles')::integer;
    v_bottles:=v_crates*v_product.bottles_per_crate+(v_fraction::numeric*v_product.bottles_per_crate/4)::integer+v_eighths*3+v_loose;
    v_half_price:=coalesce(v_product.half_crate_price::numeric,v_product.full_crate_price::numeric/2);
    v_quarter_price:=coalesce(v_product.quarter_crate_price::numeric,v_product.full_crate_price::numeric/4);
    v_line_total:=v_crates::numeric*coalesce(v_product.full_crate_price,0)+ceil(((v_fraction/2)*coalesce(v_half_price,0)
      +(v_fraction%2)*coalesce(v_quarter_price,0)+v_eighths*coalesce(v_product.full_crate_price::numeric,0)/8)/50)*50+v_loose::numeric*coalesce(v_product.bottle_price,0);
    insert into public.sale_items(sale_id,product_id,product_name,total_bottles,bottles_per_crate,line_total,bottles_returnable,crate_type,bottle_type,crate_type_id,whole_crates,crates_out,crates_returned,bottles_returned)
      values(v_id,v_product.id,concat_ws(' ',v_product.name,v_product.size),v_bottles,v_product.bottles_per_crate,v_line_total,v_product.bottles_returnable,v_product.crate_type,v_product.bottle_type,v_product.crate_type_id,v_crates,v_crates_out,v_return_crates,v_return_bottles);
    for v_choice in select value from jsonb_array_elements(coalesce(v_line->'emptyDecisions','[]'::jsonb)) loop
      if v_choice->>'kind'='crate' then
        select name into v_return_name from public.crate_types where id=(v_choice->>'returnedType')::uuid;
        select name into v_owed_name from public.crate_types where id=v_product.crate_type_id;
      else v_return_name:=v_choice->>'returnedType'; v_owed_name:=v_product.bottle_type; end if;
      insert into public.sale_empty_decisions(sale_id,customer_id,product_id,product_name,kind,returned_type,returned_name,owed_type,owed_name,quantity,decision)
      values(v_id,p_customer_id,v_product.id,concat_ws(' ',v_product.name,v_product.size),v_choice->>'kind',v_choice->>'returnedType',v_return_name,
        case when v_choice->>'kind'='crate' then v_product.crate_type_id::text else v_product.bottle_type end,v_owed_name,(v_choice->>'quantity')::integer,v_choice->>'decision');
    end loop;
    update public.stock set total_bottles=total_bottles-v_bottles where product_id=v_product.id returning total_bottles into v_stock;
    insert into public.stock_movements(product_id,movement_type,quantity_change,resulting_stock,business_date,request_id,crates,loose_bottles,bottles_per_crate,product_name,crate_type_id,sale_id)
      values(v_product.id,'sale',-v_bottles,v_stock,p_business_date,gen_random_uuid(),v_bottles/v_product.bottles_per_crate,v_bottles%v_product.bottles_per_crate,v_product.bottles_per_crate,concat_ws(' ',v_product.name,v_product.size),v_product.crate_type_id,v_id);
    if v_crates_out>v_return_crates then
      insert into public.crate_obligations(customer_id,crate_type_id,crate_type,quantity) values(p_customer_id,v_product.crate_type_id,v_product.crate_type,v_crates_out-v_return_crates)
        on conflict(customer_id,crate_type_id) do update set quantity=public.crate_obligations.quantity+excluded.quantity;
    end if;
    if v_product.bottles_returnable and v_bottles>v_return_bottles then
      insert into public.bottle_obligations(customer_id,bottle_type,quantity) values(p_customer_id,v_product.bottle_type,v_bottles-v_return_bottles)
        on conflict(customer_id,bottle_type) do update set quantity=public.bottle_obligations.quantity+excluded.quantity;
    end if;

  end loop;

  for v_return in select value from jsonb_array_elements(p_returned_crates) loop
    v_actual_quantity:=(v_return->>'quantity')::integer;
    if v_actual_quantity>0 then
      select * into v_actual_crate from public.crate_types
      where id=(v_return->>'crateTypeId')::uuid;
      insert into public.sale_empty_crate_returns(
        sale_id,crate_type_id,crate_type,quantity
      ) values(v_id,v_actual_crate.id,v_actual_crate.name,v_actual_quantity);
      select coalesce(sum(quantity),0) into v_held from public.sale_empty_decisions where sale_id=v_id and kind='crate' and decision='hold' and returned_type=v_actual_crate.id::text;
      insert into public.empty_crate_stock(crate_type_id,crate_type,quantity)
      values(v_actual_crate.id,v_actual_crate.name,v_actual_quantity-v_held)
      on conflict(crate_type_id) do update
        set quantity=public.empty_crate_stock.quantity+excluded.quantity,
            crate_type=excluded.crate_type;
    end if;
  end loop;

  for v_return in select value from jsonb_array_elements(p_returned_bottles) loop
    v_actual_quantity:=(v_return->>'quantity')::integer;
    v_actual_bottle_type:=btrim(v_return->>'bottleType');
    if v_actual_quantity>0 then
      insert into public.sale_empty_bottle_returns(
        sale_id,bottle_type,quantity
      ) values(v_id,v_actual_bottle_type,v_actual_quantity);
      select coalesce(sum(quantity),0) into v_held from public.sale_empty_decisions where sale_id=v_id and kind='bottle' and decision='hold' and returned_type=v_actual_bottle_type;
      insert into public.empty_bottle_stock(bottle_type,quantity)
      values(v_actual_bottle_type,v_actual_quantity-v_held)
      on conflict(bottle_type) do update
        set quantity=public.empty_bottle_stock.quantity+excluded.quantity;
    end if;
  end loop;

  if v_total>p_paid then
    insert into public.money_owed(customer_id,amount) values(p_customer_id,v_total-p_paid::integer)
      on conflict(customer_id) do update set amount=public.money_owed.amount+excluded.amount;
  end if;
  return jsonb_build_object('id',v_id,'total',v_total,'paid',p_paid::integer,'owing',v_total-p_paid::integer,'customer',p_customer_id);
end $function$;
