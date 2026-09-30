begin;

-- The owner is the current business in V1, as with product_cost_history.
-- An unconfigured catalogue drink can have a quoted selling price without
-- becoming a stocked/sellable public.products row.
create table public.product_selling_price_history (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id),
  catalogue_product_id uuid not null references public.product_catalogue(id),
  selling_price integer not null check (selling_price >= 0 and selling_price % 50 = 0),
  effective_on date,
  source text not null check (source in ('prior_configuration','confirmed_list','product_edit')),
  edit_order bigint generated always as identity,
  recorded_at timestamptz not null default now()
);
create index product_selling_price_history_current_idx
  on public.product_selling_price_history
  (owner_user_id,catalogue_product_id,effective_on desc nulls last,recorded_at desc,edit_order desc);
alter table public.product_selling_price_history enable row level security;
revoke all on public.product_selling_price_history from public,anon,authenticated;
grant select on public.product_selling_price_history to authenticated;
create policy owner_read on public.product_selling_price_history for select to authenticated
  using (owner_user_id=(select auth.uid()) and
    exists(select 1 from private.shop_owner where user_id=(select auth.uid())));

-- These confirmed drinks were absent from the cost list. Catalogue
-- entries alone create no stock or sale configuration.
insert into public.product_catalogue(name,manufacturer) values
  ('Budweiser',null),('Flying Fish',null),('Trophy Stout',null)
on conflict do nothing;

create table private.confirmed_selling_prices (
  name text primary key,
  amount integer not null
);
alter table private.confirmed_selling_prices enable row level security;
revoke all on private.confirmed_selling_prices from public,anon,authenticated;
insert into private.confirmed_selling_prices(name,amount) values
  ('33',10300),('Goldberg',10000),('Heineken',14000),('Star',12500),('Gulder',12600),
  ('Legend',12400),('Tiger',16500),('Radler',16200),('Amstel',16000),
  ('Desperados',22000),('Turbo',11000),('Life',10000),
  ('Medium Legend',16500),('Medium Heineken',19000),
  ('Big Stout',16500),('Small Stout',20100),
  ('Malta',15000),('Malta Can',13000),
  ('Castle Lite',10500),('Trophy',9000),
  ('Budweiser',11800),('Flying Fish',15100),
  ('Big Ice',17800),('Small Ice',17900),('Trophy Stout',11600);

do $$ begin
  if (select count(*) from private.confirmed_selling_prices s
      join public.product_catalogue c on c.name=s.name) <> 25 then
    raise exception 'A confirmed selling-price name is missing from the catalogue';
  end if;
  if exists (select 1 from private.shop_owner) and (exists (
    select 1 from public.products p
    join public.product_catalogue c on c.id=p.catalogue_product_id
    join (values ('33',10500),('Goldberg',10200),('Big Stout',16500),('Castle Lite',10200),
                 ('Desperados',22000),('Trophy',9200)) expected(name,old_price)
      on expected.name=c.name
    where p.full_crate_price<>expected.old_price
  ) or (select count(*) from public.products p
      join public.product_catalogue c on c.id=p.catalogue_product_id
      where c.name in ('33','Goldberg','Big Stout','Castle Lite','Desperados','Trophy')) <> 6) then
    raise exception 'Configured selling prices changed since review; inspect before applying';
  end if;
end $$;

-- Old configured prices have no known start date. Preserve them as such,
-- instead of inventing a historical effective date.
insert into public.product_selling_price_history
  (owner_user_id,catalogue_product_id,selling_price,effective_on,source)
select o.user_id,c.id,p.full_crate_price,null,'prior_configuration'
from private.shop_owner o
join public.products p on true
join public.product_catalogue c on c.id=p.catalogue_product_id
join private.confirmed_selling_prices s on s.name=c.name
where p.full_crate_price<>s.amount;

insert into public.product_selling_price_history
  (owner_user_id,catalogue_product_id,selling_price,effective_on,source)
select o.user_id,c.id,s.amount,date '2026-09-29','confirmed_list'
from private.shop_owner o
join private.confirmed_selling_prices s on true
join public.product_catalogue c on c.name=s.name;

-- Keep the confirmed list available when the first owner is provisioned
-- after migrations. This hook only appends missing quotes; it never changes
-- configured product prices or stock.
create function private.seed_owner_selling_prices() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.product_selling_price_history
    (owner_user_id,catalogue_product_id,selling_price,effective_on,source)
  select new.user_id,c.id,s.amount,date '2026-09-29','confirmed_list'
  from private.confirmed_selling_prices s
  join public.product_catalogue c on c.name=s.name
  where not exists (
    select 1 from public.product_selling_price_history h
    where h.owner_user_id=new.user_id and h.catalogue_product_id=c.id
      and h.source='confirmed_list' and h.effective_on=date '2026-09-29'
  );
  return new;
end $$;
revoke all on function private.seed_owner_selling_prices() from public,anon,authenticated;
create trigger seed_owner_selling_prices after insert or update of user_id
  on private.shop_owner for each row execute function private.seed_owner_selling_prices();

-- Only known configured products change. Existing IDs, stock, bottle/crate
-- setup, partial and bottle price overrides stay untouched.
update public.products p set full_crate_price=s.amount
from public.product_catalogue c
join private.confirmed_selling_prices s on s.name=c.name
where p.catalogue_product_id=c.id
  and c.name in ('33','Goldberg','Castle Lite','Trophy')
  and p.full_crate_price<>s.amount;

-- Later edits to a configured full-crate selling price should not leave the
-- catalogue quote stale. This trigger appends a dated history row atomically.
create function private.record_product_selling_price() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_owner uuid;
begin
  if new.catalogue_product_id is null or
     (new.full_crate_price is not distinct from old.full_crate_price and
      new.catalogue_product_id is not distinct from old.catalogue_product_id) then
    return new;
  end if;
  select user_id into v_owner from private.shop_owner;
  if v_owner is not null then
    insert into public.product_selling_price_history
      (owner_user_id,catalogue_product_id,selling_price,effective_on,source)
    values (v_owner,new.catalogue_product_id,new.full_crate_price,
      (now() at time zone 'Africa/Lagos')::date,'product_edit');
  end if;
  return new;
end $$;
revoke all on function private.record_product_selling_price() from public,anon,authenticated;
create trigger record_product_selling_price after update of full_crate_price,catalogue_product_id
  on public.products for each row execute function private.record_product_selling_price();

commit;
