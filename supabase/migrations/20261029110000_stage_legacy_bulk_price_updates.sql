-- Stage the original-shop atomic bulk price editor.
-- No stock, sales, debt, receipts, crate identity, or historical sale is updated.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- The page reads the same fail-closed scope used by the write RPC.
-- Returning no business is not permission to fall back to unscoped products.
create function public.get_legacy_price_editor_business_id()
returns uuid
language plpgsql stable security definer set search_path=''
as $price_scope$
declare
  v_actor uuid := private.assert_legacy_assortment_owner();
  v_business uuid;
begin
  select g.business_id into v_business
  from private.legacy_write_scope_gate g
  where g.enabled is true;
  if not found or v_business is null then
    raise exception 'Price updates are not enabled for this shop yet.'
      using errcode='42501';
  end if;
  return v_business;
end;
$price_scope$;
revoke all on function public.get_legacy_price_editor_business_id() from public,anon,authenticated,service_role;
grant execute on function public.get_legacy_price_editor_business_id() to authenticated;

-- Bottle prices are independent of crate prices. Keep an append-only history
-- that records both a new value and an explicit clearing of a bottle price.
create table public.product_bottle_selling_price_history (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id),
  business_id uuid not null,
  product_id uuid not null references public.products(id) on delete restrict,
  catalogue_product_id uuid references public.product_catalogue(id),
  bottle_price integer check (bottle_price is null or (bottle_price >= 0 and bottle_price % 50 = 0)),
  effective_on date not null,
  recorded_at timestamptz not null default now()
);
create index product_bottle_selling_price_history_current_idx
  on public.product_bottle_selling_price_history
  (owner_user_id,business_id,product_id,effective_on desc,recorded_at desc,id desc);
alter table public.product_bottle_selling_price_history enable row level security;
revoke all on public.product_bottle_selling_price_history from public,anon,authenticated,service_role;
grant select on public.product_bottle_selling_price_history to authenticated;
create policy owner_read on public.product_bottle_selling_price_history for select to authenticated
  using (owner_user_id=(select auth.uid()) and
    exists(select 1 from private.shop_owner where user_id=(select auth.uid())));

create function private.record_product_bottle_selling_price() returns trigger
language plpgsql security definer set search_path='' as $bottle_history$
declare
  v_owner uuid;
begin
  if new.bottle_price is not distinct from old.bottle_price then
    return new;
  end if;
  if new.business_id is null then
    raise exception 'Bottle-price history requires a business-scoped product.';
  end if;
  select user_id into v_owner from private.shop_owner;
  if v_owner is null then
    raise exception 'Bottle-price history requires an owner.';
  end if;
  insert into public.product_bottle_selling_price_history
    (owner_user_id,business_id,product_id,catalogue_product_id,bottle_price,effective_on)
  values (v_owner,new.business_id,new.id,new.catalogue_product_id,new.bottle_price,
    (now() at time zone 'Africa/Lagos')::date);
  return new;
end;
$bottle_history$;
revoke all on function private.record_product_bottle_selling_price() from public,anon,authenticated,service_role;
create trigger record_product_bottle_selling_price after update of bottle_price
  on public.products for each row execute function private.record_product_bottle_selling_price();

create table private.legacy_price_update_requests (
  owner_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  payload jsonb not null,
  result jsonb not null,
  recorded_at timestamptz not null default now(),
  primary key(owner_id,request_id)
);
alter table private.legacy_price_update_requests enable row level security;
revoke all on private.legacy_price_update_requests from public,anon,authenticated,service_role;

create function public.update_legacy_product_prices(
  p_request_id uuid,
  p_changes jsonb
) returns jsonb
language plpgsql volatile security definer set search_path=''
as $bulk_prices$
declare
  v_actor uuid := private.assert_legacy_assortment_owner();
  v_business uuid;
  v_saved private.legacy_price_update_requests%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_catalogue uuid;
  v_change_selling boolean;
  v_change_cost boolean;
  v_expected_full integer;
  v_new_full integer;
  v_expected_bottle integer;
  v_new_bottle integer;
  v_expected_cost integer;
  v_new_cost integer;
  v_current_cost integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_result jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_id uuid;
begin
  if p_request_id is null or jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Choose at least one price change.' using errcode='22023';
  end if;
  if jsonb_array_length(p_changes) not between 1 and 500 then
    raise exception 'Choose at least one price change.' using errcode='22023';
  end if;

  -- This legacy-only editor is unavailable until the audited write-scope
  -- gate has been explicitly enabled. Never interpret a missing/disabled gate
  -- as permission to write products whose business_id is NULL.
  select g.business_id into v_business
  from private.legacy_write_scope_gate g
  where g.enabled is true
  for share;
  if not found or v_business is null then
    raise exception 'Price updates are not enabled for this shop yet.'
      using errcode='42501';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_changes) as entry(value)
    group by entry.value->>'product_id'
    having count(*) > 1
  ) then
    raise exception 'A drink appears more than once. Review the list and try again.'
      using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('legacy-price-update:'||v_actor::text||':'||p_request_id::text,0)
  );
  select * into v_saved from private.legacy_price_update_requests
    where owner_id=v_actor and request_id=p_request_id for update;
  if found then
    if v_saved.payload is distinct from p_changes then
      raise exception 'This save request was already used with different prices. Review and save again.'
        using errcode='22023';
    end if;
    return v_saved.result;
  end if;

  -- Lock products in a stable order so overlapping batches do not deadlock.
  for v_item in
    select value from jsonb_array_elements(p_changes)
    order by value->>'product_id'
  loop
    begin
      v_id := (v_item->>'product_id')::uuid;
    exception when others then
      raise exception 'A drink could not be identified. Refresh the price list.'
        using errcode='22023';
    end;
    v_change_selling := coalesce((v_item->>'change_selling')::boolean,false);
    v_change_cost := coalesce((v_item->>'change_cost')::boolean,false);
    if not v_change_selling and not v_change_cost then
      raise exception 'No price change was selected.' using errcode='22023';
    end if;

    select * into v_product from public.products p
    where p.id=v_id and p.is_active is true
      and ((v_business is null and p.business_id is null)
        or (v_business is not null and p.business_id=v_business))
    for update;
    if not found then
      raise exception 'A drink is no longer available in this shop. Refresh the price list.'
        using errcode='40001';
    end if;

    if v_change_selling then
      v_expected_full := (v_item->>'expected_full_crate_price')::integer;
      v_new_full := (v_item->>'new_full_crate_price')::integer;
      if v_expected_full is distinct from v_product.full_crate_price
         or v_new_full is null or v_new_full < 0 or v_new_full > 2147483600
         or v_new_full % 50 <> 0 then
        raise exception 'A selling price changed elsewhere or is invalid. Refresh and review again.'
          using errcode='40001';
      end if;
      v_expected_bottle := nullif(v_item->>'expected_bottle_price','')::integer;
      v_new_bottle := nullif(v_item->>'new_bottle_price','')::integer;
      if v_expected_bottle is distinct from v_product.bottle_price
         or (v_new_bottle is not null and
             (v_new_bottle < 0 or v_new_bottle > 2147483600 or v_new_bottle % 50 <> 0)) then
        raise exception 'A bottle price changed elsewhere or is invalid. Refresh and review again.'
          using errcode='40001';
      end if;
      update public.products
      set full_crate_price=v_new_full, bottle_price=v_new_bottle
      where id=v_id;
    end if;

    if v_change_cost then
      v_catalogue := nullif(v_item->>'catalogue_product_id','')::uuid;
      v_expected_cost := nullif(v_item->>'expected_cost_price','')::integer;
      v_new_cost := nullif(v_item->>'new_cost_price','')::integer;
      if v_catalogue is null or v_product.catalogue_product_id is distinct from v_catalogue
         or v_new_cost is null or v_new_cost < 0 or v_new_cost > 2147483600 then
        raise exception 'Buying cost can only be updated for a linked catalogue drink. Refresh the list.'
          using errcode='22023';
      end if;
      select h.cost_price into v_current_cost
      from public.product_cost_history h
      where h.owner_user_id=v_actor
        and h.catalogue_product_id=v_catalogue
        and h.effective_on <= v_today
        and h.business_id is not distinct from v_product.business_id
      order by h.effective_on desc,h.recorded_at desc
      limit 1;
      if v_current_cost is distinct from v_expected_cost then
        raise exception 'A buying cost changed elsewhere. Refresh and review again.'
          using errcode='40001';
      end if;
      if v_new_cost is distinct from v_current_cost then
        insert into public.product_cost_history(
          owner_user_id,business_id,catalogue_product_id,cost_price,effective_on
        ) values(v_actor,v_product.business_id,v_catalogue,v_new_cost,v_today)
        on conflict do nothing;
        if not found then
          raise exception 'This buying cost was already recorded today. Refresh the list before trying again.'
            using errcode='22023';
        end if;
      end if;
    end if;
    v_result := v_result || jsonb_build_array(jsonb_build_object('product_id',v_id));
    v_count := v_count + 1;
  end loop;

  v_result := jsonb_build_object('saved',true,'count',v_count,'items',v_result);
  insert into private.legacy_price_update_requests(owner_id,request_id,payload,result)
  values(v_actor,p_request_id,p_changes,v_result);
  return v_result;
end;
$bulk_prices$;

revoke all on function public.update_legacy_product_prices(uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.update_legacy_product_prices(uuid,jsonb)
  to authenticated;
commit;
