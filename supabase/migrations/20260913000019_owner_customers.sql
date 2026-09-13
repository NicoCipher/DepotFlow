begin;

-- Invoker rights preserve the private singleton's RLS. This reveals only whether
-- the caller is the configured owner, never the owner's identity.
create function public.is_shop_owner() returns boolean
language sql stable security invoker set search_path = ''
as $$
  select exists (
    select 1 from private.shop_owner where user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_shop_owner() from public, anon;
grant execute on function public.is_shop_owner() to authenticated;

alter table public.customers
  add column business_name text,
  add column address text,
  -- NOT VALID leaves legacy records untouched, but checks every new/updated row.
  add constraint customers_name_length check (char_length(btrim(name)) between 1 and 120) not valid,
  add constraint customers_phone_format check (phone ~ '^\+?[0-9]{7,15}$') not valid,
  add constraint customers_business_length check (business_name is null or char_length(btrim(business_name)) between 1 and 160) not valid,
  add constraint customers_address_length check (address is null or char_length(btrim(address)) between 1 and 500) not valid;

-- IDs support retry-safe creation; existing IDs/timestamps cannot be updated.
grant insert (id, name, phone, business_name, address) on public.customers to authenticated;
grant update (name, phone, business_name, address) on public.customers to authenticated;
create policy owner_insert_customer on public.customers for insert to authenticated
  with check ((select public.is_shop_owner()));
create policy owner_update_customer on public.customers for update to authenticated
  using ((select public.is_shop_owner()))
  with check ((select public.is_shop_owner()));

commit;
