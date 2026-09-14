begin;
-- Before post-migration writes, legacy_key and retained text provide the inverse
-- mapping to the original schema. After new IDs are used, rollback requires an
-- explicit data-preserving plan; never synthesize text keys or merge balances.
-- Block concurrent writes while taking the one-to-one legacy mapping. No balance
-- is transferred: only foreign keys are added to existing rows.
lock table public.products, public.empty_crate_stock, public.empty_crate_movements,
  public.sale_items, public.crate_obligations, public.stock_movements, private.stock_receipts
  in access exclusive mode;
create table public.crate_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  empty_family text check (empty_family is null or length(btrim(empty_family)) > 0),
  pocket_count integer check (pocket_count > 0),
  variant text check (variant is null or length(btrim(variant)) > 0),
  is_legacy boolean not null default false,
  legacy_key text unique,
  created_at timestamptz not null default now(),
  check (is_legacy or (empty_family is not null and pocket_count is not null))
);
alter table public.crate_types enable row level security;
revoke all on public.crate_types from public,anon,authenticated;
grant select on public.crate_types to authenticated;
create policy owner_read on public.crate_types for select to authenticated
using (exists(select 1 from private.shop_owner where user_id=(select auth.uid())));
-- UNION uses exact existing text, never family/capacity or normalized names.
insert into public.crate_types(name,legacy_key,is_legacy)
select crate_type,crate_type,true from (
  select crate_type from public.products
  union select crate_type from public.empty_crate_stock
  union select crate_type from public.empty_crate_movements
  union select crate_type from public.sale_items
  union select crate_type from public.crate_obligations
) legacy;
-- Family is display metadata only; conflicting/missing families remain unknown.
update public.crate_types c set empty_family=f.family from (
  select crate_type,min(empty_family) as family from public.products
  group by crate_type having count(distinct empty_family)=1
) f where c.legacy_key=f.crate_type;
-- Only this existing identity has owner-confirmed physical attributes.
update public.crate_types set empty_family='NBL',pocket_count=20,variant='short',is_legacy=false
where legacy_key='Desperados';
-- Group labels stay unresolved, regardless of matching product bottle counts.
update public.crate_types set empty_family=legacy_key where legacy_key in ('NBL','Trophy');

alter table public.products add column crate_type_id uuid references public.crate_types(id);
update public.products r set crate_type_id=c.id from public.crate_types c where r.crate_type=c.legacy_key;
alter table public.products alter column crate_type_id set not null;
alter table public.empty_crate_stock add column crate_type_id uuid references public.crate_types(id);
update public.empty_crate_stock r set crate_type_id=c.id from public.crate_types c where r.crate_type=c.legacy_key;
alter table public.empty_crate_stock alter column crate_type_id set not null;
alter table public.empty_crate_movements add column crate_type_id uuid references public.crate_types(id);
update public.empty_crate_movements r set crate_type_id=c.id from public.crate_types c where r.crate_type=c.legacy_key;
alter table public.empty_crate_movements alter column crate_type_id set not null;
alter table public.sale_items add column crate_type_id uuid references public.crate_types(id);
update public.sale_items r set crate_type_id=c.id from public.crate_types c where r.crate_type=c.legacy_key;
alter table public.sale_items alter column crate_type_id set not null;
alter table public.crate_obligations add column crate_type_id uuid references public.crate_types(id);
update public.crate_obligations r set crate_type_id=c.id from public.crate_types c where r.crate_type=c.legacy_key;
alter table public.crate_obligations alter column crate_type_id set not null;
-- Original text survives as traceability, not as the operational key.
drop view public.known_empty_crates;
alter table public.empty_crate_movements drop constraint empty_crate_movements_crate_type_fkey;
alter table public.empty_crate_stock drop constraint empty_crate_stock_pkey;
alter table public.empty_crate_stock add primary key (crate_type_id);
alter table public.crate_obligations drop constraint crate_obligations_pkey;
alter table public.crate_obligations add primary key (customer_id,crate_type_id);
alter table public.products alter column crate_type drop not null;
alter table public.empty_crate_stock alter column crate_type drop not null;
alter table public.empty_crate_movements alter column crate_type drop not null;
alter table public.sale_items alter column crate_type drop not null;
alter table public.crate_obligations alter column crate_type drop not null;
create index products_crate_type_id_idx on public.products(crate_type_id);
create index empty_crate_movements_crate_type_id_idx on public.empty_crate_movements(crate_type_id);
create index sale_items_crate_type_id_idx on public.sale_items(crate_type_id);
create index crate_obligations_crate_type_id_idx on public.crate_obligations(crate_type_id);
-- These records had no crate reference; reconstructing one from the CURRENT
-- product would invent history. Old rows retain NULL; new writes capture the ID.
alter table public.stock_movements add column crate_type_id uuid references public.crate_types(id);
alter table private.stock_receipts add column crate_type_id uuid references public.crate_types(id);
create index stock_movements_crate_type_id_idx on public.stock_movements(crate_type_id);
create index stock_receipts_crate_type_id_idx on private.stock_receipts(crate_type_id);

create view public.known_empty_crates with (security_invoker=true) as
select c.id as crate_type_id,c.name,c.empty_family,c.pocket_count,c.variant,c.is_legacy,s.quantity
from public.crate_types c left join public.empty_crate_stock s on s.crate_type_id=c.id;
revoke all on public.known_empty_crates from public,anon,authenticated;
grant select on public.known_empty_crates to authenticated;
revoke insert(crate_type,empty_family),update(crate_type,empty_family) on public.products from authenticated;
grant insert(crate_type_id),update(crate_type_id) on public.products to authenticated;

-- Identity is immutable, even to an accidental future UPDATE grant.
create function private.immutable_crate_id() returns trigger language plpgsql set search_path='' as $$
begin
  if new.id is distinct from old.id then raise exception using errcode='22023',message='Crate identity cannot change.'; end if;
  return new;
end $$;
revoke all on function private.immutable_crate_id() from public,anon,authenticated;
create trigger immutable_crate_id before update on public.crate_types for each row execute function private.immutable_crate_id();

create function private.create_crate_type(p_id uuid,p_name text,p_empty_family text,p_pocket_count numeric,p_variant text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_type public.crate_types%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from private.shop_owner where user_id=auth.uid()) then
    raise exception using errcode='42501',message='Owner only'; end if;
  p_name := btrim(p_name); p_empty_family := btrim(p_empty_family); p_variant := nullif(btrim(p_variant),'');
  if p_id is null or p_name is null or length(p_name) not between 1 and 120
    or p_empty_family is null or length(p_empty_family) not between 1 and 80
    or length(p_variant)>120 or p_pocket_count is null or p_pocket_count < 1
    or p_pocket_count > 2147483647 or p_pocket_count <> trunc(p_pocket_count) or p_pocket_count='NaN'::numeric then
    raise exception using errcode='22023',message='Enter a name, family and positive whole pocket count.'; end if;
  insert into public.crate_types(id,name,empty_family,pocket_count,variant)
    values(p_id,p_name,p_empty_family,p_pocket_count::integer,p_variant) on conflict(id) do nothing;
  select * into v_type from public.crate_types where id=p_id;
  if v_type.is_legacy or v_type.name is distinct from p_name or v_type.empty_family is distinct from p_empty_family
    or v_type.pocket_count is distinct from p_pocket_count or v_type.variant is distinct from p_variant then
    raise exception using errcode='22023',message='This crate form was already saved with different details.'; end if;
  return v_type.id;
end $$;
revoke all on function private.create_crate_type(uuid,text,text,numeric,text) from public,anon;
grant execute on function private.create_crate_type(uuid,text,text,numeric,text) to authenticated;
create function public.create_crate_type(p_id uuid,p_name text,p_empty_family text,p_pocket_count numeric,p_variant text)
returns uuid language sql security invoker set search_path='' as $$
select private.create_crate_type(p_id,p_name,p_empty_family,p_pocket_count,p_variant); $$;
revoke all on function public.create_crate_type(uuid,text,text,numeric,text) from public,anon;
grant execute on function public.create_crate_type(uuid,text,text,numeric,text) to authenticated;

-- Replace only the crate relationship in receiving; quantity arithmetic,
-- request locking, row locking and retry returns remain unchanged.
drop function public.receive_stock(uuid,uuid,numeric,integer,integer,integer,text,date);
drop function private.receive_stock(uuid,uuid,numeric,integer,integer,integer,text,date);
create function private.receive_stock(
  p_request_id uuid, p_product_id uuid, p_crates numeric,
  p_expected_stock integer, p_expected_empties integer,
  p_expected_bottles_per_crate integer, p_expected_crate_type_id uuid, p_business_date date
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
    where crate_type_id = v_product.crate_type_id for update;
  if not found or v_empties < p_crates then
    raise exception using errcode = '22023', message = 'Not enough empty crates of this type.';
  end if;
  insert into public.stock(product_id,total_bottles) values (p_product_id,0) on conflict do nothing;
  select total_bottles into v_stock from public.stock where product_id=p_product_id for update;
  if p_expected_stock is distinct from v_stock
    or p_expected_empties is distinct from v_empties
    or p_expected_bottles_per_crate is distinct from v_product.bottles_per_crate
    or p_expected_crate_type_id is distinct from v_product.crate_type_id then
    raise exception using errcode = '22023', message = 'Stock or product details changed. Review again.';
  end if;
  v_added := p_crates * v_product.bottles_per_crate;
  if v_stock + v_added > 2147483647 then
    raise exception using errcode = '22023', message = 'That would exceed the stock limit.';
  end if;
  update public.empty_crate_stock set quantity=quantity-p_crates::integer
    where crate_type_id=v_product.crate_type_id;
  update public.stock set total_bottles=total_bottles+v_added::integer where product_id=p_product_id;
  insert into private.stock_receipts(request_id,product_id,crates,stock_after,empties_after,business_date,crate_type_id) values (p_request_id,p_product_id,p_crates::integer,(v_stock+v_added)::integer,v_empties-p_crates::integer,p_business_date,v_product.crate_type_id);
  insert into public.stock_movements(product_id,movement_type,quantity_change,resulting_stock,business_date,request_id,crates,loose_bottles,bottles_per_crate,product_name,crate_type_id)
  values(p_product_id,'receive',v_added::integer,(v_stock+v_added)::integer,p_business_date,p_request_id,p_crates::integer,0,v_product.bottles_per_crate,concat_ws(' ',v_product.name,v_product.size),v_product.crate_type_id);
  return jsonb_build_object('stock_after', (v_stock+v_added)::integer, 'empties_after', v_empties-p_crates::integer);
end $$;
revoke all on function private.receive_stock(uuid,uuid,numeric,integer,integer,integer,uuid,date) from public,anon;
grant execute on function private.receive_stock(uuid,uuid,numeric,integer,integer,integer,uuid,date) to authenticated;

create function public.receive_stock(
  p_request_id uuid, p_product_id uuid, p_crates numeric,
  p_expected_stock integer, p_expected_empties integer,
  p_expected_bottles_per_crate integer, p_expected_crate_type_id uuid, p_business_date date
) returns jsonb language sql security invoker set search_path = ''
as $$ select private.receive_stock(p_request_id,p_product_id,p_crates,p_expected_stock,p_expected_empties,p_expected_bottles_per_crate,p_expected_crate_type_id,p_business_date); $$;
revoke all on function public.receive_stock(uuid,uuid,numeric,integer,integer,integer,uuid,date) from public,anon;
grant execute on function public.receive_stock(uuid,uuid,numeric,integer,integer,integer,uuid,date) to authenticated;

create or replace function private.set_current_stock(
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
  insert into public.stock_movements(product_id,movement_type,quantity_change,resulting_stock,business_date,request_id,crates,loose_bottles,bottles_per_crate,product_name,crate_type_id)
  values(p_product_id,'count',v_total::integer-v_stock,v_total::integer,p_business_date,p_request_id,p_crates::integer,p_loose_bottles::integer,v_product.bottles_per_crate,concat_ws(' ',v_product.name,v_product.size),v_product.crate_type_id);
  return jsonb_build_object('stock_after',v_total::integer);
end $$;
revoke all on function private.set_current_stock(uuid,uuid,numeric,numeric,date,integer,integer) from public,anon;
grant execute on function private.set_current_stock(uuid,uuid,numeric,numeric,date,integer,integer) to authenticated;
create or replace function public.set_current_stock(
  p_request_id uuid, p_product_id uuid, p_crates numeric, p_loose_bottles numeric,
  p_business_date date, p_expected_stock integer, p_expected_bottles_per_crate integer
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_current_stock(p_request_id,p_product_id,p_crates,p_loose_bottles,p_business_date,p_expected_stock,p_expected_bottles_per_crate);
$$;
revoke all on function public.set_current_stock(uuid,uuid,numeric,numeric,date,integer,integer) from public,anon;
grant execute on function public.set_current_stock(uuid,uuid,numeric,numeric,date,integer,integer) to authenticated;

drop function public.set_empty_crate_count(uuid,text,numeric,date,integer);
drop function private.set_empty_crate_count(uuid,text,numeric,date,integer);
create function private.set_empty_crate_count(
  p_request_id uuid, p_crate_type_id uuid, p_quantity numeric,
  p_business_date date, p_expected_quantity integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_movement public.empty_crate_movements%rowtype;
  v_inserted boolean;
  v_quantity integer;
  v_previous integer;
begin
  if auth.uid() is null or not exists(select 1 from private.shop_owner where user_id=auth.uid()) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_request_id is null or p_crate_type_id is null then
    raise exception using errcode='22023',message='Choose an existing crate type.';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 2147483647
    or p_quantity <> trunc(p_quantity) or p_quantity = 'NaN'::numeric then
    raise exception using errcode='22023',message='Enter a whole number of crates, zero or more.';
  end if;
  if p_business_date is null or p_business_date not between date '0001-01-01' and date '9999-12-31' then
    raise exception using errcode='22023',message='Choose a valid business date.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  select * into v_movement from public.empty_crate_movements where request_id=p_request_id;
  if found then
    if v_movement.crate_type_id <> p_crate_type_id or v_movement.movement_type <> 'count'
      or v_movement.resulting_quantity <> p_quantity or v_movement.business_date <> p_business_date then
      raise exception using errcode='22023',message='This count form has already been used.';
    end if;
    return jsonb_build_object('quantity_after',v_movement.resulting_quantity);
  end if;
  if not exists(select 1 from public.crate_types where id=p_crate_type_id) then
    raise exception using errcode='22023',message='Choose an existing crate type.';
  end if;
  -- The unique crate type serializes competing first counts. Existing rows use
  -- the same row lock as receive_stock; neither operation can lose an update.
  insert into public.empty_crate_stock(crate_type_id,quantity) values(p_crate_type_id,0)
    on conflict do nothing returning true into v_inserted;
  select quantity into v_quantity from public.empty_crate_stock where crate_type_id=p_crate_type_id for update;
  v_previous := case when v_inserted then null else v_quantity end;
  if p_expected_quantity is distinct from v_previous then
    raise exception using errcode='22023',message='Empty crates changed. Review the count again.';
  end if;
  update public.empty_crate_stock set quantity=p_quantity::integer where crate_type_id=p_crate_type_id;
  insert into public.empty_crate_movements(crate_type_id,movement_type,previous_quantity,quantity_change,resulting_quantity,business_date,request_id)
    values(p_crate_type_id,'count',v_previous,p_quantity::integer-coalesce(v_previous,0),p_quantity::integer,p_business_date,p_request_id);
  return jsonb_build_object('quantity_after',p_quantity::integer);
end $$;
revoke all on function private.set_empty_crate_count(uuid,uuid,numeric,date,integer) from public,anon;
grant execute on function private.set_empty_crate_count(uuid,uuid,numeric,date,integer) to authenticated;
create function public.set_empty_crate_count(
  p_request_id uuid, p_crate_type_id uuid, p_quantity numeric,
  p_business_date date, p_expected_quantity integer
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_empty_crate_count(p_request_id,p_crate_type_id,p_quantity,p_business_date,p_expected_quantity);
$$;
revoke all on function public.set_empty_crate_count(uuid,uuid,numeric,date,integer) from public,anon;
grant execute on function public.set_empty_crate_count(uuid,uuid,numeric,date,integer) to authenticated;

commit;
