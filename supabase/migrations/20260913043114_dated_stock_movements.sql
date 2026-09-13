begin;
-- No dates are invented for receipts saved before this migration.
alter table private.stock_receipts add column business_date date;

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
  movement_type text not null check (movement_type in ('receive','count')),
  quantity_change integer not null,
  resulting_stock integer not null check (resulting_stock >= 0),
  business_date date not null check (business_date between date '0001-01-01' and date '9999-12-31'),
  created_at timestamptz not null default now(),
  request_id uuid not null unique,
  crates integer not null check (crates >= 0),
  loose_bottles integer not null check (loose_bottles >= 0 and loose_bottles < bottles_per_crate),
  bottles_per_crate integer not null check (bottles_per_crate > 0),
  product_name text not null,
  check (movement_type <> 'receive' or (crates > 0 and loose_bottles = 0 and quantity_change > 0))
);
create index stock_movements_recent_idx on public.stock_movements(created_at desc,id desc);
create index stock_movements_product_idx on public.stock_movements(product_id);
alter table public.stock_movements enable row level security;
revoke all on public.stock_movements from public,anon,authenticated;
grant select on public.stock_movements to authenticated;
create policy owner_read on public.stock_movements for select to authenticated
using (exists(select 1 from private.shop_owner where user_id = (select auth.uid())));

-- Remove the undated overload so no receiving path can omit a business date.
drop function public.receive_stock(uuid,uuid,numeric,integer,integer,integer,text);
drop function private.receive_stock(uuid,uuid,numeric,integer,integer,integer,text);

create function private.receive_stock(
  p_request_id uuid, p_product_id uuid, p_crates numeric,
  p_expected_stock integer, p_expected_empties integer,
  p_expected_bottles_per_crate integer, p_expected_crate_type text, p_business_date date
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_receipt private.stock_receipts%rowtype;
  v_stock integer;
  v_empties integer;
  v_added numeric;
begin
  if auth.uid() is null or not exists (
    select 1 from private.shop_owner where user_id = auth.uid()
  ) then raise exception using errcode = '42501', message = 'Owner only'; end if;
  if p_request_id is null or p_product_id is null or p_crates is null
    or p_crates <= 0 or p_crates > 2147483647 or p_crates <> trunc(p_crates)
    or p_crates = 'NaN'::numeric
  then raise exception using errcode = '22023', message = 'Enter a positive whole number of crates.'; end if;

  if p_business_date is null or p_business_date not between date '0001-01-01' and date '9999-12-31' then
    raise exception using errcode = '22023', message = 'Choose a valid business date.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  select * into v_receipt from private.stock_receipts where request_id = p_request_id;
  if found then
    if v_receipt.product_id <> p_product_id or v_receipt.crates <> p_crates or v_receipt.business_date is distinct from p_business_date then
      raise exception using errcode = '22023', message = 'This receiving form has already been used.';
    end if;
    return jsonb_build_object('stock_after', v_receipt.stock_after, 'empties_after', v_receipt.empties_after);
  end if;

  if exists(select 1 from public.stock_movements where request_id = p_request_id) then
    raise exception using errcode = '22023', message = 'This stock form has already been used.';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then raise exception using errcode = '22023', message = 'Product not found.'; end if;
  select quantity into v_empties from public.empty_crate_stock
    where crate_type = v_product.crate_type for update;
  if not found or v_empties < p_crates then
    raise exception using errcode = '22023', message = 'Not enough empty crates of this type.';
  end if;
  insert into public.stock(product_id,total_bottles) values (p_product_id,0) on conflict do nothing;
  select total_bottles into v_stock from public.stock where product_id=p_product_id for update;
  if p_expected_stock is distinct from v_stock
    or p_expected_empties is distinct from v_empties
    or p_expected_bottles_per_crate is distinct from v_product.bottles_per_crate
    or p_expected_crate_type is distinct from v_product.crate_type then
    raise exception using errcode = '22023', message = 'Stock or product details changed. Review again.';
  end if;
  v_added := p_crates * v_product.bottles_per_crate;
  if v_stock + v_added > 2147483647 then
    raise exception using errcode = '22023', message = 'That would exceed the stock limit.';
  end if;
  update public.empty_crate_stock set quantity=quantity-p_crates::integer
    where crate_type=v_product.crate_type;
  update public.stock set total_bottles=total_bottles+v_added::integer where product_id=p_product_id;
  insert into private.stock_receipts values (p_request_id,p_product_id,p_crates::integer,(v_stock+v_added)::integer,v_empties-p_crates::integer,p_business_date);
  insert into public.stock_movements(product_id,movement_type,quantity_change,resulting_stock,business_date,request_id,crates,loose_bottles,bottles_per_crate,product_name)
  values(p_product_id,'receive',v_added::integer,(v_stock+v_added)::integer,p_business_date,p_request_id,p_crates::integer,0,v_product.bottles_per_crate,concat_ws(' ',v_product.name,v_product.size));
  return jsonb_build_object('stock_after', (v_stock+v_added)::integer, 'empties_after', v_empties-p_crates::integer);
end $$;
revoke all on function private.receive_stock(uuid,uuid,numeric,integer,integer,integer,text,date) from public,anon;
grant execute on function private.receive_stock(uuid,uuid,numeric,integer,integer,integer,text,date) to authenticated;

create function public.receive_stock(
  p_request_id uuid, p_product_id uuid, p_crates numeric,
  p_expected_stock integer, p_expected_empties integer,
  p_expected_bottles_per_crate integer, p_expected_crate_type text, p_business_date date
) returns jsonb language sql security invoker set search_path = ''
as $$ select private.receive_stock(p_request_id,p_product_id,p_crates,p_expected_stock,p_expected_empties,p_expected_bottles_per_crate,p_expected_crate_type,p_business_date); $$;
revoke all on function public.receive_stock(uuid,uuid,numeric,integer,integer,integer,text,date) from public,anon;
grant execute on function public.receive_stock(uuid,uuid,numeric,integer,integer,integer,text,date) to authenticated;

create function private.set_current_stock(
  p_request_id uuid, p_product_id uuid, p_crates numeric, p_loose_bottles numeric,
  p_business_date date, p_expected_stock integer, p_expected_bottles_per_crate integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_product public.products%rowtype;
  v_movement public.stock_movements%rowtype;
  v_stock integer;
  v_total numeric;
begin
  if auth.uid() is null or not exists(select 1 from private.shop_owner where user_id=auth.uid()) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_request_id is null or p_product_id is null
    or p_crates is null or p_crates < 0 or p_crates > 2147483647 or p_crates <> trunc(p_crates) or p_crates = 'NaN'::numeric
    or p_loose_bottles is null or p_loose_bottles < 0 or p_loose_bottles > 2147483647 or p_loose_bottles <> trunc(p_loose_bottles) or p_loose_bottles = 'NaN'::numeric then
    raise exception using errcode='22023',message='Enter whole numbers of crates and loose bottles, zero or more.';
  end if;
  if p_business_date is null or p_business_date not between date '0001-01-01' and date '9999-12-31' then
    raise exception using errcode='22023',message='Choose a valid business date.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  select * into v_movement from public.stock_movements where request_id=p_request_id;
  if found then
    if v_movement.movement_type <> 'count' or v_movement.product_id <> p_product_id
      or v_movement.crates <> p_crates or v_movement.loose_bottles <> p_loose_bottles
      or v_movement.business_date <> p_business_date then
      raise exception using errcode='22023',message='This stock form has already been used.';
    end if;
    return jsonb_build_object('stock_after',v_movement.resulting_stock);
  end if;
  if exists(select 1 from private.stock_receipts where request_id=p_request_id) then
    raise exception using errcode='22023',message='This stock form has already been used.';
  end if;
  select * into v_product from public.products where id=p_product_id for update;
  if not found then raise exception using errcode='22023',message='Product not found.'; end if;
  if p_loose_bottles >= v_product.bottles_per_crate then
    raise exception using errcode='22023',message='Loose bottles must be fewer than a full crate.';
  end if;
  v_total := p_crates * v_product.bottles_per_crate + p_loose_bottles;
  if v_total > 2147483647 then raise exception using errcode='22023',message='That would exceed the stock limit.'; end if;
  insert into public.stock(product_id,total_bottles) values(p_product_id,0) on conflict do nothing;
  select total_bottles into v_stock from public.stock where product_id=p_product_id for update;
  if p_expected_stock is distinct from v_stock or p_expected_bottles_per_crate is distinct from v_product.bottles_per_crate then
    raise exception using errcode='22023',message='Stock or product details changed. Review again.';
  end if;
  update public.stock set total_bottles=v_total::integer where product_id=p_product_id;
  insert into public.stock_movements(product_id,movement_type,quantity_change,resulting_stock,business_date,request_id,crates,loose_bottles,bottles_per_crate,product_name)
  values(p_product_id,'count',v_total::integer-v_stock,v_total::integer,p_business_date,p_request_id,p_crates::integer,p_loose_bottles::integer,v_product.bottles_per_crate,concat_ws(' ',v_product.name,v_product.size));
  return jsonb_build_object('stock_after',v_total::integer);
end $$;
revoke all on function private.set_current_stock(uuid,uuid,numeric,numeric,date,integer,integer) from public,anon;
grant execute on function private.set_current_stock(uuid,uuid,numeric,numeric,date,integer,integer) to authenticated;
create function public.set_current_stock(
  p_request_id uuid, p_product_id uuid, p_crates numeric, p_loose_bottles numeric,
  p_business_date date, p_expected_stock integer, p_expected_bottles_per_crate integer
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_current_stock(p_request_id,p_product_id,p_crates,p_loose_bottles,p_business_date,p_expected_stock,p_expected_bottles_per_crate);
$$;
revoke all on function public.set_current_stock(uuid,uuid,numeric,numeric,date,integer,integer) from public,anon;
grant execute on function public.set_current_stock(uuid,uuid,numeric,numeric,date,integer,integer) to authenticated;
commit;
