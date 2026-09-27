begin;

-- Deposit rules are business-wide, not brand-specific. Complete-crate deposit
-- is keyed by pocket count; bottle deposit is one global current price.
do $$
begin
  if exists(
    select c.pocket_count
    from public.crate_deposit_prices p
    join public.crate_types c on c.id=p.crate_type_id
    where c.pocket_count is not null
    group by c.pocket_count
    having count(distinct p.amount)>1
  ) then
    raise exception 'Conflicting crate deposit prices exist for the same pocket count.';
  end if;
  if (select count(distinct amount) from public.bottle_deposit_prices)>1 then
    raise exception 'Conflicting bottle deposit prices exist.';
  end if;
end $$;

create temporary table migrated_crate_deposits on commit drop as
select c.pocket_count, max(p.amount)::integer as complete_crate_amount
from public.crate_deposit_prices p
join public.crate_types c on c.id=p.crate_type_id
where c.pocket_count is not null
group by c.pocket_count;

create temporary table migrated_bottle_deposit on commit drop as
select max(amount)::integer as amount
from public.bottle_deposit_prices;

drop function if exists public.set_crate_deposit_price(uuid,numeric);
drop function if exists private.set_crate_deposit_price(uuid,numeric);
drop function if exists public.set_bottle_deposit_price(text,numeric);
drop function if exists private.set_bottle_deposit_price(text,numeric);
drop table public.crate_deposit_prices;
drop table public.bottle_deposit_prices;

create table public.crate_deposit_prices (
  pocket_count integer primary key check (pocket_count > 0),
  complete_crate_amount integer not null
    check (complete_crate_amount > 0 and complete_crate_amount % 50 = 0),
  crate_only_amount integer
    check (crate_only_amount is null or (crate_only_amount > 0 and crate_only_amount % 50 = 0)),
  updated_at timestamptz not null default now()
);

create table public.bottle_deposit_price (
  id smallint primary key default 1 check (id=1),
  amount integer not null check (amount > 0 and amount % 50 = 0),
  updated_at timestamptz not null default now()
);

insert into public.crate_deposit_prices(pocket_count,complete_crate_amount)
select pocket_count,complete_crate_amount from migrated_crate_deposits;

insert into public.bottle_deposit_price(id,amount)
select 1,amount from migrated_bottle_deposit where amount is not null;

alter table public.crate_deposit_prices enable row level security;
alter table public.bottle_deposit_price enable row level security;
revoke all on public.crate_deposit_prices from public,anon,authenticated;
revoke all on public.bottle_deposit_price from public,anon,authenticated;
grant select on public.crate_deposit_prices to authenticated;
grant select on public.bottle_deposit_price to authenticated;
create policy owner_read on public.crate_deposit_prices
  for select to authenticated using ((select public.is_shop_owner()));
create policy owner_read on public.bottle_deposit_price
  for select to authenticated using ((select public.is_shop_owner()));

create function private.set_crate_deposit_price(
  p_pocket_count numeric,
  p_complete_amount numeric,
  p_crate_only_amount numeric
) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(
    select 1 from private.shop_owner where user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='Owner only';
  end if;

  if p_pocket_count is null or p_pocket_count='NaN'::numeric
    or p_pocket_count<1 or p_pocket_count>2147483647
    or p_pocket_count<>trunc(p_pocket_count)
    or not exists(
      select 1 from public.crate_types
      where not is_legacy and pocket_count=p_pocket_count::integer
    ) then
    raise exception using errcode='22023',message='Choose a pocket count used by an exact crate type.';
  end if;

  if p_complete_amount is null then
    delete from public.crate_deposit_prices
    where pocket_count=p_pocket_count::integer;
    return;
  end if;

  if p_complete_amount='NaN'::numeric or p_complete_amount<1
    or p_complete_amount>2147483647 or p_complete_amount<>trunc(p_complete_amount)
    or mod(p_complete_amount,50)<>0
    or (p_crate_only_amount is not null and (
      p_crate_only_amount='NaN'::numeric or p_crate_only_amount<1
      or p_crate_only_amount>2147483647 or p_crate_only_amount<>trunc(p_crate_only_amount)
      or mod(p_crate_only_amount,50)<>0
    )) then
    raise exception using errcode='22023',message='Enter deposit prices in whole naira, in ₦50 steps.';
  end if;

  insert into public.crate_deposit_prices(
    pocket_count,complete_crate_amount,crate_only_amount,updated_at
  ) values(
    p_pocket_count::integer,p_complete_amount::integer,p_crate_only_amount::integer,now()
  )
  on conflict(pocket_count) do update set
    complete_crate_amount=excluded.complete_crate_amount,
    crate_only_amount=excluded.crate_only_amount,
    updated_at=excluded.updated_at;
end $$;
revoke all on function private.set_crate_deposit_price(numeric,numeric,numeric) from public,anon;
grant execute on function private.set_crate_deposit_price(numeric,numeric,numeric) to authenticated;

create function public.set_crate_deposit_price(
  p_pocket_count numeric,
  p_complete_amount numeric,
  p_crate_only_amount numeric
) returns void
language sql security invoker set search_path='' as $$
  select private.set_crate_deposit_price(
    p_pocket_count,p_complete_amount,p_crate_only_amount
  );
$$;
revoke all on function public.set_crate_deposit_price(numeric,numeric,numeric) from public,anon;
grant execute on function public.set_crate_deposit_price(numeric,numeric,numeric) to authenticated;

create function private.set_bottle_deposit_price(p_amount numeric)
returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(
    select 1 from private.shop_owner where user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='Owner only';
  end if;

  if p_amount is null then
    delete from public.bottle_deposit_price where id=1;
    return;
  end if;

  if p_amount='NaN'::numeric or p_amount<1 or p_amount>2147483647
    or p_amount<>trunc(p_amount) or mod(p_amount,50)<>0 then
    raise exception using errcode='22023',message='Enter a bottle deposit price in whole naira, in ₦50 steps.';
  end if;

  insert into public.bottle_deposit_price(id,amount,updated_at)
  values(1,p_amount::integer,now())
  on conflict(id) do update set amount=excluded.amount,updated_at=excluded.updated_at;
end $$;
revoke all on function private.set_bottle_deposit_price(numeric) from public,anon;
grant execute on function private.set_bottle_deposit_price(numeric) to authenticated;

create function public.set_bottle_deposit_price(p_amount numeric)
returns void
language sql security invoker set search_path='' as $$
  select private.set_bottle_deposit_price(p_amount);
$$;
revoke all on function public.set_bottle_deposit_price(numeric) from public,anon;
grant execute on function public.set_bottle_deposit_price(numeric) to authenticated;

-- Selling "one crate" is a quantity/pricing fact. A physical crate leaving the
-- depot is a separate packaging fact. Historical rows keep their old meaning.
alter table public.sale_items drop constraint sale_return_bounds;
alter table public.sale_items add column physical_crates_out integer;
update public.sale_items set physical_crates_out=whole_crates;
alter table public.sale_items
  alter column physical_crates_out set not null,
  alter column physical_crates_out set default 0;
alter table public.sale_items
  add constraint physical_crates_out_nonnegative check (physical_crates_out>=0),
  add constraint physical_crates_out_not_more_than_whole check (physical_crates_out<=whole_crates);
alter table public.sale_items drop column crates_out;
alter table public.sale_items rename column physical_crates_out to crates_out;
alter table public.sale_items
  add constraint sale_return_bounds
  check (crates_returned<=crates_out and bottles_returned<=returnable_bottles_out);

-- Optional cratesTaken prepares the sale RPC for bottles-only/sack sales.
-- Existing clients omit it and retain today's behavior (cratesTaken=whole crates).
create or replace function private.save_sale(p_request_id uuid,p_customer_id uuid,p_business_date date,p_paid numeric,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_sale public.sales%rowtype;
  v_customer public.customers%rowtype;
  v_product public.products%rowtype;
  v_crate public.crate_types%rowtype;
  v_line jsonb;
  v_stock integer;
  v_crates integer;
  v_crates_out integer;
  v_fraction integer;
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
begin
  if auth.uid() is null or not exists(select 1 from private.shop_owner where user_id=auth.uid()) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_request_id is null or p_customer_id is null or p_business_date is null or p_paid is null
    or p_paid='NaN'::numeric or p_paid<0 or p_paid<>trunc(p_paid) or p_paid>2147483647
    or jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 1000 then
    raise exception using errcode='22023',message='Check the sale details.';
  end if;
  v_payload:=jsonb_build_object('customer',p_customer_id,'date',p_business_date,'paid',p_paid,'lines',p_lines);
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
      or coalesce((v_line->'quantity'->>'bottles') !~ '^\d{1,9}$',true)
      or (v_line ? 'cratesTaken' and coalesce((v_line->>'cratesTaken') !~ '^\d{1,9}$',true))
      or coalesce((v_line->>'returnedCrates') !~ '^\d{1,9}$',true) or coalesce((v_line->>'returnedBottles') !~ '^\d{1,9}$',true) then
      raise exception using errcode='22023',message='Enter whole quantities of drinks and empties.';
    end if;
    v_crates:=(v_line->'quantity'->>'crates')::integer;
    v_fraction:=(v_line->'quantity'->>'fraction')::integer;
    v_loose:=(v_line->'quantity'->>'bottles')::integer;
    v_crates_out:=coalesce((v_line->>'cratesTaken')::integer,v_crates);
    v_return_crates:=(v_line->>'returnedCrates')::integer;
    v_return_bottles:=(v_line->>'returnedBottles')::integer;
    if (v_fraction::numeric*v_product.bottles_per_crate)%4<>0 then raise exception using errcode='22023',message='That fraction does not make whole bottles.'; end if;
    if v_crates::numeric*v_product.bottles_per_crate + (v_fraction::numeric*v_product.bottles_per_crate/4)::integer + v_loose >2147483647 then
      raise exception using errcode='22023',message='That quantity is too large.'; end if;
    v_bottles:=v_crates*v_product.bottles_per_crate+(v_fraction::numeric*v_product.bottles_per_crate/4)::integer+v_loose;
    if v_bottles<1 or v_crates_out>v_crates or v_return_crates>v_crates_out
      or v_return_bottles>(case when v_product.bottles_returnable then v_bottles else 0 end) then
      raise exception using errcode='22023',message='Check returned empties.'; end if;
    if v_crates>0 then
      select * into v_crate from public.crate_types where id=v_product.crate_type_id for share;
      if not found or v_crate.is_legacy or v_crate.pocket_count is distinct from v_product.bottles_per_crate then
        raise exception using errcode='22023',message='Choose an exact crate type for this drink before saving.';
      end if;
    end if;
    if (v_crates>0 and v_product.full_crate_price is null)
      or (v_fraction>=2 and v_product.half_crate_price is null and v_product.full_crate_price is null)
      or (v_fraction%2=1 and v_product.quarter_crate_price is null and v_product.full_crate_price is null)
      or (v_loose>0 and v_product.bottle_price is null) then
      raise exception using errcode='22023',message='A price is missing. Review the sale.';
    end if;
    v_half_price:=coalesce(v_product.half_crate_price::numeric,v_product.full_crate_price::numeric/2);
    v_quarter_price:=coalesce(v_product.quarter_crate_price::numeric,v_product.full_crate_price::numeric/4);
    if (v_fraction>=2 and v_half_price<>trunc(v_half_price)) or (v_fraction%2=1 and v_quarter_price<>trunc(v_quarter_price)) then
      raise exception using errcode='22023',message='Set a partial-crate price override because the full-crate price does not divide into whole naira.';
    end if;
    if v_crates::numeric*coalesce(v_product.full_crate_price,0)+(v_fraction/2)*coalesce(v_half_price,0)
      +(v_fraction%2)*coalesce(v_quarter_price,0)+v_loose::numeric*coalesce(v_product.bottle_price,0)>2147483647 then
      raise exception using errcode='22023',message='Sale total is too large.'; end if;
    v_line_total:=v_crates::numeric*coalesce(v_product.full_crate_price,0)+(v_fraction/2)*coalesce(v_half_price,0)
      +(v_fraction%2)*coalesce(v_quarter_price,0)+v_loose::numeric*coalesce(v_product.bottle_price,0);
    if v_line_total::numeric+v_total>2147483647 then raise exception using errcode='22023',message='Sale total is too large.'; end if;
    v_total:=v_total+v_line_total;
    select total_bottles into v_stock from public.stock where product_id=v_product.id for update;
    if not found or v_stock<v_bottles then raise exception using errcode='22023',message='Not enough stock. Review the sale.'; end if;
  end loop;
  if p_paid>v_total then raise exception using errcode='22023',message='Amount paid cannot exceed the total.'; end if;
  insert into public.sales(customer_id,total_amount,paid_amount,business_date,request_id,request_payload)
    values(p_customer_id,v_total,p_paid::integer,p_business_date,p_request_id,v_payload) returning id into v_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    select * into v_product from public.products where id=(v_line->>'productId')::uuid;
    v_crates:=(v_line->'quantity'->>'crates')::integer;
    v_fraction:=(v_line->'quantity'->>'fraction')::integer;
    v_loose:=(v_line->'quantity'->>'bottles')::integer;
    v_crates_out:=coalesce((v_line->>'cratesTaken')::integer,v_crates);
    v_return_crates:=(v_line->>'returnedCrates')::integer;
    v_return_bottles:=(v_line->>'returnedBottles')::integer;
    v_bottles:=v_crates*v_product.bottles_per_crate+(v_fraction::numeric*v_product.bottles_per_crate/4)::integer+v_loose;
    v_half_price:=coalesce(v_product.half_crate_price::numeric,v_product.full_crate_price::numeric/2);
    v_quarter_price:=coalesce(v_product.quarter_crate_price::numeric,v_product.full_crate_price::numeric/4);
    v_line_total:=v_crates::numeric*coalesce(v_product.full_crate_price,0)+(v_fraction/2)*coalesce(v_half_price,0)
      +(v_fraction%2)*coalesce(v_quarter_price,0)+v_loose::numeric*coalesce(v_product.bottle_price,0);
    insert into public.sale_items(sale_id,product_id,product_name,total_bottles,bottles_per_crate,line_total,bottles_returnable,crate_type,bottle_type,crate_type_id,whole_crates,crates_out,crates_returned,bottles_returned)
      values(v_id,v_product.id,concat_ws(' ',v_product.name,v_product.size),v_bottles,v_product.bottles_per_crate,v_line_total,v_product.bottles_returnable,v_product.crate_type,v_product.bottle_type,v_product.crate_type_id,v_crates,v_crates_out,v_return_crates,v_return_bottles);
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
    if v_return_crates>0 then
      insert into public.empty_crate_stock(crate_type_id,crate_type,quantity) values(v_product.crate_type_id,v_product.crate_type,v_return_crates)
        on conflict(crate_type_id) do update set quantity=public.empty_crate_stock.quantity+excluded.quantity;
    end if;
    if v_return_bottles>0 then
      insert into public.empty_bottle_stock(bottle_type,quantity) values(v_product.bottle_type,v_return_bottles)
        on conflict(bottle_type) do update set quantity=public.empty_bottle_stock.quantity+excluded.quantity;
    end if;
  end loop;
  if v_total>p_paid then
    insert into public.money_owed(customer_id,amount) values(p_customer_id,v_total-p_paid::integer)
      on conflict(customer_id) do update set amount=public.money_owed.amount+excluded.amount;
  end if;
  return jsonb_build_object('id',v_id,'total',v_total,'paid',p_paid::integer,'owing',v_total-p_paid::integer,'customer',p_customer_id);
end $$;

revoke all on function private.save_sale(uuid,uuid,date,numeric,jsonb) from public,anon,authenticated;

commit;
