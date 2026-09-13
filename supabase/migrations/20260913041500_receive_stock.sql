begin;

-- Private retry records: no direct API reads or writes, no history UI.
create table private.stock_receipts (
  request_id uuid primary key,
  product_id uuid not null references public.products(id),
  crates integer not null check (crates > 0),
  stock_after integer not null check (stock_after >= 0),
  empties_after integer not null check (empties_after >= 0)
);
alter table private.stock_receipts enable row level security;
revoke all on private.stock_receipts from public, anon, authenticated;

-- Privileged work stays outside the exposed schema; authorization is checked here
-- on every call. No direct stock/empty-stock write grants are needed.
create function private.receive_stock(
  p_request_id uuid, p_product_id uuid, p_crates numeric,
  p_expected_stock integer, p_expected_empties integer,
  p_expected_bottles_per_crate integer, p_expected_crate_type text
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  select * into v_receipt from private.stock_receipts where request_id = p_request_id;
  if found then
    if v_receipt.product_id <> p_product_id or v_receipt.crates <> p_crates then
      raise exception using errcode = '22023', message = 'This receiving form has already been used.';
    end if;
    return jsonb_build_object('stock_after', v_receipt.stock_after, 'empties_after', v_receipt.empties_after);
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
  insert into private.stock_receipts values (p_request_id,p_product_id,p_crates::integer,(v_stock+v_added)::integer,v_empties-p_crates::integer);
  return jsonb_build_object('stock_after', (v_stock+v_added)::integer, 'empties_after', v_empties-p_crates::integer);
end $$;
revoke all on function private.receive_stock(uuid,uuid,numeric,integer,integer,integer,text) from public,anon;
grant execute on function private.receive_stock(uuid,uuid,numeric,integer,integer,integer,text) to authenticated;

create function public.receive_stock(
  p_request_id uuid, p_product_id uuid, p_crates numeric,
  p_expected_stock integer, p_expected_empties integer,
  p_expected_bottles_per_crate integer, p_expected_crate_type text
) returns jsonb language sql security invoker set search_path = ''
as $$ select private.receive_stock(p_request_id,p_product_id,p_crates,p_expected_stock,p_expected_empties,p_expected_bottles_per_crate,p_expected_crate_type); $$;
revoke all on function public.receive_stock(uuid,uuid,numeric,integer,integer,integer,text) from public,anon;
grant execute on function public.receive_stock(uuid,uuid,numeric,integer,integer,integer,text) to authenticated;
commit;
