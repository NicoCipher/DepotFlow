begin;

-- Existing customers keep today's behavior: missing empties may become obligations.
-- This setting only prepares the next sale-flow milestone; it does not change sale logic yet.
alter table public.customers
  add column empties_deposit_required boolean not null default false;
grant update (empties_deposit_required) on public.customers to authenticated;

-- Compatibility is explicit and directional. Exact crate identity is always valid
-- and therefore does not need a self-row here. Family/pocket metadata remains
-- descriptive; it never silently creates a swap rule.
create table public.crate_swap_rules (
  owed_crate_type_id uuid not null references public.crate_types(id) on delete restrict,
  returned_crate_type_id uuid not null references public.crate_types(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (owed_crate_type_id, returned_crate_type_id),
  check (owed_crate_type_id <> returned_crate_type_id)
);
create index crate_swap_rules_returned_idx
  on public.crate_swap_rules(returned_crate_type_id);

-- These are CURRENT prices only. A future sale/return must snapshot the price it
-- actually uses so changing a price later cannot rewrite history.
create table public.crate_deposit_prices (
  crate_type_id uuid primary key references public.crate_types(id) on delete restrict,
  amount integer not null check (amount > 0 and amount % 50 = 0),
  updated_at timestamptz not null default now()
);
create table public.bottle_deposit_prices (
  bottle_type text primary key check (length(btrim(bottle_type)) > 0),
  amount integer not null check (amount > 0 and amount % 50 = 0),
  updated_at timestamptz not null default now()
);

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'crate_swap_rules',
    'crate_deposit_prices',
    'bottle_deposit_prices'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format(
      'create policy owner_read on public.%I for select to authenticated using
       ((select public.is_shop_owner()))',
      table_name
    );
  end loop;
end $$;

create function private.set_crate_swap_rules(
  p_owed_crate_type_id uuid,
  p_returned_crate_type_ids uuid[]
) returns void
language plpgsql security definer set search_path='' as $$
declare
  v_legacy boolean;
begin
  if auth.uid() is null or not exists(
    select 1 from private.shop_owner where user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_owed_crate_type_id is null then
    raise exception using errcode='22023',message='Choose a crate type.';
  end if;
  select is_legacy into v_legacy
  from public.crate_types
  where id=p_owed_crate_type_id
  for key share;
  if not found or v_legacy then
    raise exception using errcode='22023',message='Choose an exact crate type.';
  end if;
  if exists(
    select 1
    from unnest(coalesce(p_returned_crate_type_ids,'{}'::uuid[])) as selected(returned_id)
    left join public.crate_types c on c.id=selected.returned_id
    where selected.returned_id is null
      or selected.returned_id=p_owed_crate_type_id
      or c.id is null
      or c.is_legacy
  ) then
    raise exception using errcode='22023',message='Choose only exact replacement crate types.';
  end if;

  delete from public.crate_swap_rules
  where owed_crate_type_id=p_owed_crate_type_id;

  insert into public.crate_swap_rules(owed_crate_type_id,returned_crate_type_id)
  select p_owed_crate_type_id,selected.returned_id
  from (
    select distinct returned_id
    from unnest(coalesce(p_returned_crate_type_ids,'{}'::uuid[])) as x(returned_id)
  ) selected;
end $$;
revoke all on function private.set_crate_swap_rules(uuid,uuid[]) from public,anon;
grant execute on function private.set_crate_swap_rules(uuid,uuid[]) to authenticated;

create function public.set_crate_swap_rules(
  p_owed_crate_type_id uuid,
  p_returned_crate_type_ids uuid[]
) returns void
language sql security invoker set search_path='' as $$
  select private.set_crate_swap_rules(p_owed_crate_type_id,p_returned_crate_type_ids);
$$;
revoke all on function public.set_crate_swap_rules(uuid,uuid[]) from public,anon;
grant execute on function public.set_crate_swap_rules(uuid,uuid[]) to authenticated;

create function private.set_crate_deposit_price(
  p_crate_type_id uuid,
  p_amount numeric
) returns void
language plpgsql security definer set search_path='' as $$
declare
  v_legacy boolean;
begin
  if auth.uid() is null or not exists(
    select 1 from private.shop_owner where user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_crate_type_id is null then
    raise exception using errcode='22023',message='Choose a crate type.';
  end if;
  select is_legacy into v_legacy
  from public.crate_types
  where id=p_crate_type_id
  for key share;
  if not found or v_legacy then
    raise exception using errcode='22023',message='Choose an exact crate type.';
  end if;

  if p_amount is null then
    delete from public.crate_deposit_prices where crate_type_id=p_crate_type_id;
    return;
  end if;
  if p_amount='NaN'::numeric or p_amount<1 or p_amount>2147483647
    or p_amount<>trunc(p_amount) or mod(p_amount,50)<>0 then
    raise exception using errcode='22023',message='Enter a deposit price in whole naira, in ₦50 steps.';
  end if;

  insert into public.crate_deposit_prices(crate_type_id,amount,updated_at)
  values(p_crate_type_id,p_amount::integer,now())
  on conflict(crate_type_id) do update
    set amount=excluded.amount,updated_at=excluded.updated_at;
end $$;
revoke all on function private.set_crate_deposit_price(uuid,numeric) from public,anon;
grant execute on function private.set_crate_deposit_price(uuid,numeric) to authenticated;

create function public.set_crate_deposit_price(
  p_crate_type_id uuid,
  p_amount numeric
) returns void
language sql security invoker set search_path='' as $$
  select private.set_crate_deposit_price(p_crate_type_id,p_amount);
$$;
revoke all on function public.set_crate_deposit_price(uuid,numeric) from public,anon;
grant execute on function public.set_crate_deposit_price(uuid,numeric) to authenticated;

create function private.set_bottle_deposit_price(
  p_bottle_type text,
  p_amount numeric
) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(
    select 1 from private.shop_owner where user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  p_bottle_type:=btrim(p_bottle_type);
  if p_bottle_type is null or length(p_bottle_type) not between 1 and 120
    or not exists(
      select 1 from public.products
      where bottles_returnable and bottle_type=p_bottle_type
    ) then
    raise exception using errcode='22023',message='Choose a returnable bottle type used by a drink.';
  end if;

  if p_amount is null then
    delete from public.bottle_deposit_prices where bottle_type=p_bottle_type;
    return;
  end if;
  if p_amount='NaN'::numeric or p_amount<1 or p_amount>2147483647
    or p_amount<>trunc(p_amount) or mod(p_amount,50)<>0 then
    raise exception using errcode='22023',message='Enter a deposit price in whole naira, in ₦50 steps.';
  end if;

  insert into public.bottle_deposit_prices(bottle_type,amount,updated_at)
  values(p_bottle_type,p_amount::integer,now())
  on conflict(bottle_type) do update
    set amount=excluded.amount,updated_at=excluded.updated_at;
end $$;
revoke all on function private.set_bottle_deposit_price(text,numeric) from public,anon;
grant execute on function private.set_bottle_deposit_price(text,numeric) to authenticated;

create function public.set_bottle_deposit_price(
  p_bottle_type text,
  p_amount numeric
) returns void
language sql security invoker set search_path='' as $$
  select private.set_bottle_deposit_price(p_bottle_type,p_amount);
$$;
revoke all on function public.set_bottle_deposit_price(text,numeric) from public,anon;
grant execute on function public.set_bottle_deposit_price(text,numeric) to authenticated;

commit;
