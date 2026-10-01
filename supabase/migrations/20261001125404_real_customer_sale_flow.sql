-- Receipt identity is owner-managed and captured when a receipt is created.
create table public.shop_profile (
  id boolean primary key default true check (id),
  name text not null check (length(trim(name)) between 1 and 120),
  address text not null default '' check (length(address)<=500),
  phone text not null default '' check (length(phone)<=40),
  logo_url text not null default '' check (length(logo_url)<=1000 and (logo_url='' or logo_url ~ '^https://'))
);
alter table public.shop_profile enable row level security;
create policy owner_profile on public.shop_profile for select to authenticated using (public.is_shop_owner());
grant select on public.shop_profile to authenticated;
create function private.save_business_details(p_name text,p_address text,p_phone text,p_logo_url text) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_shop_owner() then raise exception using errcode='42501',message='Owner only'; end if;
  insert into public.shop_profile(id,name,address,phone,logo_url) values(true,btrim(p_name),btrim(p_address),btrim(p_phone),btrim(p_logo_url))
    on conflict(id) do update set name=excluded.name,address=excluded.address,phone=excluded.phone,logo_url=excluded.logo_url;
end;
$$;
create function public.save_business_details(p_name text,p_address text,p_phone text,p_logo_url text) returns void language plpgsql security invoker set search_path='' as $$
begin perform private.save_business_details(p_name,p_address,p_phone,p_logo_url); end;
$$;
revoke all on function public.save_business_details(text,text,text,text),private.save_business_details(text,text,text,text) from public,anon;
grant execute on function public.save_business_details(text,text,text,text),private.save_business_details(text,text,text,text) to authenticated;
alter table public.sales add column receipt_business jsonb;
alter table public.customer_payments add column receipt_business jsonb;
create function private.capture_receipt_business() returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.receipt_business:=(select jsonb_build_object('name',name,'address',address,'phone',phone,'logo_url',logo_url) from public.shop_profile where id);
  return new;
end;
$$;
create trigger capture_sale_business before insert on public.sales for each row execute function private.capture_receipt_business();
create trigger capture_payment_business before insert on public.customer_payments for each row execute function private.capture_receipt_business();
revoke all on function private.capture_receipt_business() from public,anon,authenticated;

create table public.sale_empty_decisions (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  customer_id uuid not null references public.customers(id),
  product_id uuid not null references public.products(id),
  product_name text not null,
  kind text not null check (kind in ('crate','bottle')),
  returned_type text not null,
  returned_name text not null,
  owed_type text not null,
  owed_name text not null,
  quantity integer not null check (quantity>0),
  decision text not null check (decision in ('accept','hold')),
  released_at timestamptz,
  check (released_at is null or decision='hold')
);
alter table public.sale_empty_decisions enable row level security;
create policy owner_empty_choices on public.sale_empty_decisions for select to authenticated using (public.is_shop_owner());
grant select on public.sale_empty_decisions to authenticated;

create function private.check_sale_empty_choices(p_lines jsonb,p_crates jsonb,p_bottles jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  states jsonb:='[]'; crates jsonb:='{}'; bottles jsonb:='{}'; assigned jsonb:='{}';
  line jsonb; row jsonb; item jsonb; choice jsonb; rule record; product public.products%rowtype;
  index integer; pass integer; quantity integer; pocket integer; returned_pocket integer; returned_bottle text;
  owed integer; available integer; kind text; key text; owed_type text; target text; has_choices boolean:=false;
begin
  if auth.uid() is null or not public.is_shop_owner() then raise exception using errcode='42501',message='Owner only'; end if;
  for item in select value from jsonb_array_elements(p_crates) loop crates:=jsonb_set(crates,array[item->>'crateTypeId'],item->'quantity'); end loop;
  for item in select value from jsonb_array_elements(p_bottles) loop bottles:=jsonb_set(bottles,array[item->>'bottleType'],item->'quantity'); end loop;
  for line in select value from jsonb_array_elements(p_lines) loop
    select * into product from public.products where id=(line->>'productId')::uuid;
    states:=states||jsonb_build_array(jsonb_build_object(
      'product',product.id,'crate',product.crate_type_id,'bottle',product.bottle_type,
      'crates',coalesce((line->>'cratesTaken')::integer,(line->'quantity'->>'crates')::integer),
      'bottles',case when product.bottles_returnable then (line->'quantity'->>'crates')::integer*product.bottles_per_crate
        +(line->'quantity'->>'fraction')::integer*product.bottles_per_crate/4+coalesce((line->'quantity'->>'eighths')::integer,0)*3+(line->'quantity'->>'bottles')::integer else 0 end,
      'settledCrates',0,'settledBottles',0));
    if line ? 'emptyDecisions' then
      if jsonb_typeof(line->'emptyDecisions') is distinct from 'array' or jsonb_array_length(line->'emptyDecisions')>1000 then raise exception using errcode='22023',message='Check the empties choices.'; end if;
      has_choices:=has_choices or jsonb_array_length(line->'emptyDecisions')>0;
    end if;
  end loop;
  -- Exact packages, permanent complete swaps (when there are no choices),
  -- exact crates, then exact bottles. This mirrors the owner preview.
  for pass in select value from unnest(case when has_choices then array[1,3,4,5,2] else array[1,2,3,4] end) as value loop
    for index in 0..jsonb_array_length(states)-1 loop
      row:=states->index;
      pocket:=(select pocket_count from public.crate_types where id=(row->>'crate')::uuid);
      if pass=1 and pocket is not null and row->>'bottle' is not null then
        quantity:=least((row->>'crates')::integer,coalesce((crates->>(row->>'crate'))::integer,0),coalesce((bottles->>(row->>'bottle'))::integer,0)/pocket,(row->>'bottles')::integer/pocket);
        if quantity>0 then
          crates:=jsonb_set(crates,array[row->>'crate'],to_jsonb((crates->>(row->>'crate'))::integer-quantity));
          bottles:=jsonb_set(bottles,array[row->>'bottle'],to_jsonb((bottles->>(row->>'bottle'))::integer-quantity*pocket));
          row:=row||jsonb_build_object('crates',(row->>'crates')::integer-quantity,'bottles',(row->>'bottles')::integer-quantity*pocket,'settledCrates',(row->>'settledCrates')::integer+quantity,'settledBottles',(row->>'settledBottles')::integer+quantity*pocket);
        end if;
      elsif pass=2 and (not has_choices or jsonb_array_length(coalesce((p_lines->index)->'emptyDecisions','[]'::jsonb))=0) and pocket is not null and row->>'bottle' is not null then
        for rule in select returned_crate_type_id from public.crate_swap_rules where owed_crate_type_id=(row->>'crate')::uuid order by returned_crate_type_id loop
          returned_pocket:=(select pocket_count from public.crate_types where id=rule.returned_crate_type_id);
          select case when count(distinct bottle_type)=1 then min(bottle_type) end into returned_bottle from public.products where crate_type_id=rule.returned_crate_type_id and bottles_returnable and bottle_type is not null;
          if returned_pocket is distinct from pocket or returned_bottle is null or rule.returned_crate_type_id::text=row->>'crate' then continue; end if;
          quantity:=least((row->>'crates')::integer,coalesce((crates->>rule.returned_crate_type_id::text)::integer,0),coalesce((bottles->>returned_bottle)::integer,0)/pocket,(row->>'bottles')::integer/pocket);
          if quantity>0 then
            crates:=jsonb_set(crates,array[rule.returned_crate_type_id::text],to_jsonb((crates->>rule.returned_crate_type_id::text)::integer-quantity));
            bottles:=jsonb_set(bottles,array[returned_bottle],to_jsonb((bottles->>returned_bottle)::integer-quantity*pocket));
            row:=row||jsonb_build_object('crates',(row->>'crates')::integer-quantity,'bottles',(row->>'bottles')::integer-quantity*pocket,'settledCrates',(row->>'settledCrates')::integer+quantity,'settledBottles',(row->>'settledBottles')::integer+quantity*pocket);
          end if;
        end loop;
      elsif pass=3 then
        quantity:=least((row->>'crates')::integer,coalesce((crates->>(row->>'crate'))::integer,0));
        if quantity>0 then
          crates:=jsonb_set(crates,array[row->>'crate'],to_jsonb((crates->>(row->>'crate'))::integer-quantity));
          row:=row||jsonb_build_object('crates',(row->>'crates')::integer-quantity,'settledCrates',(row->>'settledCrates')::integer+quantity);
        end if;
      elsif pass=4 and row->>'bottle' is not null then
        quantity:=least((row->>'bottles')::integer,coalesce((bottles->>(row->>'bottle'))::integer,0));
        if quantity>0 then
          bottles:=jsonb_set(bottles,array[row->>'bottle'],to_jsonb((bottles->>(row->>'bottle'))::integer-quantity));
          row:=row||jsonb_build_object('bottles',(row->>'bottles')::integer-quantity,'settledBottles',(row->>'settledBottles')::integer+quantity);
        end if;
      end if;
      if pass=5 then
        line:=p_lines->index;
    for choice in select value from jsonb_array_elements(coalesce(line->'emptyDecisions','[]'::jsonb)) loop
      kind:=choice->>'kind'; target:=choice->>'returnedType';
      if jsonb_typeof(choice) is distinct from 'object' or kind not in ('crate','bottle') or kind is null or coalesce(choice->>'decision','') not in ('accept','hold') or coalesce(choice->>'productId','')<>row->>'product' or coalesce(choice->>'quantity','') !~ '^[0-9]{1,9}$' then raise exception using errcode='22023',message='Check the empties choices.'; end if;
      quantity:=(choice->>'quantity')::integer;
      owed_type:=case when kind='crate' then row->>'crate' else row->>'bottle' end;
      key:=(row->>'product')||':'||kind;
      owed:=(row->>(case when kind='crate' then 'crates' else 'bottles' end))::integer;
      available:=coalesce(((case when kind='crate' then crates else bottles end)->>target)::integer,0);
      if quantity<=0 or owed_type is null or target is null or target=owed_type or quantity+coalesce((assigned->>key)::integer,0)>owed or quantity>available then raise exception using errcode='22023',message='Check the empties choices.'; end if;
      if kind='crate' then
        pocket:=(select pocket_count from public.crate_types where id=(row->>'crate')::uuid);
        returned_pocket:=(select pocket_count from public.crate_types where id=target::uuid);
        if choice->>'decision'='accept' and (pocket is null or returned_pocket is distinct from pocket) then raise exception using errcode='22023',message='Check the empties choices.'; end if;
        crates:=jsonb_set(crates,array[target],to_jsonb(available-quantity));
      else bottles:=jsonb_set(bottles,array[target],to_jsonb(available-quantity)); end if;
      if choice->>'decision'='accept' then
        if kind='crate' then row:=row||jsonb_build_object('crates',owed-quantity,'settledCrates',(row->>'settledCrates')::integer+quantity);
        else row:=row||jsonb_build_object('bottles',owed-quantity,'settledBottles',(row->>'settledBottles')::integer+quantity); end if;
      else assigned:=jsonb_set(assigned,array[key],to_jsonb(coalesce((assigned->>key)::integer,0)+quantity)); end if;
    end loop;
      end if;
      states:=jsonb_set(states,array[index::text],row);
    end loop;
  end loop;
  for index in 0..jsonb_array_length(states)-1 loop
    row:=states->index; line:=p_lines->index;
    if (line->>'returnedCrates')::integer<>(row->>'settledCrates')::integer or (line->>'returnedBottles')::integer<>(row->>'settledBottles')::integer then raise exception using errcode='22023',message='Check the empties choices.'; end if;
  end loop;
  if exists(select 1 from jsonb_each_text(crates) x where x.value::integer>0)
    or exists(select 1 from jsonb_each_text(bottles) x where x.value::integer>0) then
    raise exception using errcode='22023',message='Choose Accept or Hold for the different empties before saving.';
  end if;
end;
$$;
revoke all on function private.check_sale_empty_choices(jsonb,jsonb,jsonb) from public,anon,authenticated;

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
    if v_eighths>0 and (v_product.full_crate_price is null or (v_product.full_crate_price::numeric*v_eighths/8)<>trunc(v_product.full_crate_price::numeric*v_eighths/8)) then
      raise exception using errcode='22023',message='The crate price does not give a whole-naira price for this bottle quantity.';
    end if;
    v_half_price:=coalesce(v_product.half_crate_price::numeric,v_product.full_crate_price::numeric/2);
    v_quarter_price:=coalesce(v_product.quarter_crate_price::numeric,v_product.full_crate_price::numeric/4);
    if (v_fraction>=2 and v_half_price<>trunc(v_half_price)) or (v_fraction%2=1 and v_quarter_price<>trunc(v_quarter_price)) then
      raise exception using errcode='22023',message='Set a partial-crate price override because the full-crate price does not divide into whole naira.';
    end if;
    if v_crates::numeric*coalesce(v_product.full_crate_price,0)+(v_fraction/2)*coalesce(v_half_price,0)
      +(v_fraction%2)*coalesce(v_quarter_price,0)+v_eighths*coalesce(v_product.full_crate_price::numeric,0)/8+v_loose::numeric*coalesce(v_product.bottle_price,0)>2147483647 then
      raise exception using errcode='22023',message='Sale total is too large.'; end if;
    v_line_total:=v_crates::numeric*coalesce(v_product.full_crate_price,0)+(v_fraction/2)*coalesce(v_half_price,0)
      +(v_fraction%2)*coalesce(v_quarter_price,0)+v_eighths*coalesce(v_product.full_crate_price::numeric,0)/8+v_loose::numeric*coalesce(v_product.bottle_price,0);
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
    if v_eighths>0 and (v_product.full_crate_price is null or (v_product.full_crate_price::numeric*v_eighths/8)<>trunc(v_product.full_crate_price::numeric*v_eighths/8)) then
      raise exception using errcode='22023',message='The crate price does not give a whole-naira price for this bottle quantity.';
    end if;
    v_half_price:=coalesce(v_product.half_crate_price::numeric,v_product.full_crate_price::numeric/2);
    v_quarter_price:=coalesce(v_product.quarter_crate_price::numeric,v_product.full_crate_price::numeric/4);
    v_line_total:=v_crates::numeric*coalesce(v_product.full_crate_price,0)+(v_fraction/2)*coalesce(v_half_price,0)
      +(v_fraction%2)*coalesce(v_quarter_price,0)+v_eighths*coalesce(v_product.full_crate_price::numeric,0)/8+v_loose::numeric*coalesce(v_product.bottle_price,0);
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


-- Returning held property to its customer changes neither usable stock nor debt.
create function public.release_held_empties(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
  perform private.release_held_empties(p_id);
end;
$$;
create function private.release_held_empties(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_shop_owner() then raise exception using errcode='42501',message='Owner only'; end if;
  update public.sale_empty_decisions set released_at=now() where id=p_id and decision='hold' and released_at is null;
end;
$$;
revoke all on function public.release_held_empties(uuid) from public,anon;
revoke all on function private.release_held_empties(uuid) from public,anon;
grant execute on function public.release_held_empties(uuid),private.release_held_empties(uuid) to authenticated;

-- Correct empties may arrive later, without another sale or any money payment.
create table private.customer_empty_returns (
  request_id uuid primary key,
  customer_id uuid not null references public.customers(id),
  request_payload jsonb not null,
  created_at timestamptz not null default now()
);
create function private.record_customer_empty_return(p_request_id uuid,p_customer_id uuid,p_crates jsonb,p_bottles jsonb,p_release_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare payload jsonb; previous jsonb; item jsonb; quantity integer; owed integer; label text; held uuid; changed integer;
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
  if exists(select 1 from jsonb_array_elements(p_crates) x group by x->>'crateTypeId' having count(*)>1) or exists(select 1 from jsonb_array_elements(p_bottles) x group by x->>'bottleType' having count(*)>1) then raise exception using errcode='22023',message='Check the returned empties.'; end if;
  for item in select value from jsonb_array_elements(p_crates) order by value->>'crateTypeId' loop
    if coalesce(item->>'crateTypeId','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or coalesce(item->>'quantity','') !~ '^[1-9][0-9]{0,8}$' then raise exception using errcode='22023',message='Check the returned empties.'; end if;
    quantity:=(item->>'quantity')::integer;
    select public.crate_obligations.quantity into owed from public.crate_obligations where customer_id=p_customer_id and crate_type_id=(item->>'crateTypeId')::uuid for update;
    if not found or quantity>owed then raise exception using errcode='22023',message='More crates were entered than this customer owes. Check the counts.'; end if;
    select name into label from public.crate_types where id=(item->>'crateTypeId')::uuid;
    update public.crate_obligations set quantity=public.crate_obligations.quantity-(item->>'quantity')::integer where customer_id=p_customer_id and crate_type_id=(item->>'crateTypeId')::uuid;
    insert into public.empty_crate_stock(crate_type_id,crate_type,quantity) values((item->>'crateTypeId')::uuid,label,(item->>'quantity')::integer)
      on conflict(crate_type_id) do update set quantity=public.empty_crate_stock.quantity+excluded.quantity;
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
create function public.record_customer_empty_return(p_request_id uuid,p_customer_id uuid,p_crates jsonb,p_bottles jsonb,p_release_ids uuid[])
returns void language plpgsql security invoker set search_path='' as $$
begin perform private.record_customer_empty_return(p_request_id,p_customer_id,p_crates,p_bottles,p_release_ids); end;
$$;
revoke all on function public.record_customer_empty_return(uuid,uuid,jsonb,jsonb,uuid[]),private.record_customer_empty_return(uuid,uuid,jsonb,jsonb,uuid[]) from public,anon;
grant execute on function public.record_customer_empty_return(uuid,uuid,jsonb,jsonb,uuid[]),private.record_customer_empty_return(uuid,uuid,jsonb,jsonb,uuid[]) to authenticated;
