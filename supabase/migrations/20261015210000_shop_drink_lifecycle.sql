begin;

-- Shop assortment lifecycle. Removing a drink must never delete its stock,
-- existing sales, debts, receipts, original catalogue entry or crate identity.
alter table public.products
  add column is_active boolean not null default true;

comment on column public.products.is_active is
  'False: no new sales; retain physical stock, sale history and master catalogue.';

-- Owner-only lifecycle change with optimistic stale-screen protection.
create function public.set_shop_drink_active(
  p_id uuid, p_active boolean, p_expected_active boolean
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare
  v_current boolean;
begin
  if auth.uid() is null
     or not exists (select 1 from private.shop_owner
                    where user_id=auth.uid()) then
    raise exception using errcode='42501', message='Shop owner only';
  end if;
  if p_id is null or p_active is null or p_expected_active is null then
    raise exception using errcode='22023', message='Check the drink and try again';
  end if;
  select is_active into v_current
  from public.products where id=p_id for update;
  if not found then
    raise exception using errcode='P0002', message='Drink no longer exists';
  end if;
  -- Same result is a harmless retry after a lost response.
  if v_current=p_active then return v_current; end if;
  if v_current is distinct from p_expected_active then
    raise exception using errcode='40001',
      message='Drink status changed; reload before trying again';
  end if;
  update public.products set is_active=p_active where id=p_id;
  return p_active;
end $$;
revoke all on function public.set_shop_drink_active(uuid,boolean,boolean)
  from public,anon;
grant execute on function public.set_shop_drink_active(uuid,boolean,boolean)
  to authenticated;

-- Final DB-level sale fence, including stale tabs and direct RPC calls.
-- FOR SHARE serializes any ongoing new sale with removing/restoring a drink.
-- Idempotent replays of already committed sales do not INSERT sale_items.
create function private.prevent_removed_shop_drink_sale()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  v_active boolean;
begin
  select is_active into v_active from public.products
  where id=new.product_id for share;
  if not found or v_active is distinct from true then
    raise exception using errcode='22023',
      message='This drink was removed from the shop; restore it before selling';
  end if;
  return new;
end $$;
revoke all on function private.prevent_removed_shop_drink_sale()
  from public,anon,authenticated,service_role;

create trigger block_removed_drink_sale
  before insert on public.sale_items
  for each row execute function private.prevent_removed_shop_drink_sale();


-- Receiving stock must be checked in the same transaction, not just in
-- the server action's review screen. The existing receiving RPC already
-- locks products before updating stock; this final fence ensures removed
-- drinks cannot receive into hidden stock via stale forms or direct calls.
-- Successful request-ID retries return from the receiving RPC before INSERT.
create function private.prevent_removed_shop_drink_receive()
returns trigger
language plpgsql security definer set search_path=''
as $
declare
  v_active boolean;
begin
  if new.movement_type='receive' then
    select is_active into v_active from public.products
    where id=new.product_id for share;
    if not found or v_active is distinct from true then
      raise exception using errcode='22023',
        message='This drink was removed from the shop; restore it before receiving stock';
    end if;
  end if;
  return new;
end $;
revoke all on function private.prevent_removed_shop_drink_receive()
  from public,anon,authenticated,service_role;

create trigger block_removed_drink_receive
  before insert on public.stock_movements
  for each row execute function private.prevent_removed_shop_drink_receive();

commit;
