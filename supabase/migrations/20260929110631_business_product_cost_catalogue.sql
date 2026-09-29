begin;

-- Catalogue identities have no stock, selling price, or packaging assumptions.
-- public.products remains this shop's configured, sellable assortment.
create table public.product_catalogue (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  manufacturer text check (manufacturer in ('NB', 'GN')),
  created_at timestamptz not null default now()
);
create unique index product_catalogue_name_key on public.product_catalogue (lower(btrim(name)));
alter table public.product_catalogue enable row level security;
revoke all on public.product_catalogue from public, anon, authenticated;
grant select on public.product_catalogue to authenticated;
create policy owner_read on public.product_catalogue for select to authenticated
  using (exists(select 1 from private.shop_owner where user_id=(select auth.uid())));

alter table public.products add column catalogue_product_id uuid
  references public.product_catalogue(id);
create unique index products_catalogue_product_id_key on public.products(catalogue_product_id)
  where catalogue_product_id is not null;
grant update (catalogue_product_id) on public.products to authenticated;

-- The single shop owner identifies the current business in V1. A future
-- businesses table can replace this scope without changing catalogue IDs.
-- Costs are append-only; the latest effective date / recording time is current.
-- Future stock receipts must save their actual cost and supplier at receipt
-- time; historical valuation must not re-read the latest catalogue cost.
create table public.product_cost_history (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id),
  catalogue_product_id uuid not null references public.product_catalogue(id),
  cost_price integer not null check (cost_price >= 0),
  effective_on date not null,
  recorded_at timestamptz not null default now(),
  unique (owner_user_id, catalogue_product_id, effective_on, cost_price)
);
create index product_cost_history_current_idx on public.product_cost_history
  (owner_user_id, catalogue_product_id, effective_on desc, recorded_at desc);
alter table public.product_cost_history enable row level security;
revoke all on public.product_cost_history from public, anon, authenticated;
grant select on public.product_cost_history to authenticated;
create policy owner_read on public.product_cost_history for select to authenticated
  using (owner_user_id=(select auth.uid()) and
    exists(select 1 from private.shop_owner where user_id=(select auth.uid())));

insert into public.product_catalogue(name,manufacturer) values
  ('33','NB'),('Goldberg','NB'),('Life','NB'),('Heineken','NB'),
  ('Medium Heineken','NB'),('Star','NB'),('Gulder','NB'),('Legend','NB'),
  ('Medium Legend','NB'),('Tiger','NB'),('Radler','NB'),('Amstel','NB'),
  ('Maltina','NB'),('Desperado','NB'),('Turbo','NB'),('Small Turbo','NB'),
  ('Goldberg Black','NB'),('Fayrouz','NB'),('Amstel Can','NB'),
  ('Maltina Can','NB'),('Maltina PET 33cl','NB'),('Maltina PET 50cl','NB'),
  ('Maltina PET 25cl','NB'),('Fayrouz Can','NB'),('Heineken Can','NB'),
  ('Goldberg Can','NB'),('Desperados Can','NB'),('Chamdor','NB'),
  ('4th Street','NB'),
  ('Big Stout','GN'),('Small Stout','GN'),('Medium Stout','GN'),
  ('Malta','GN'),('Big Ice','GN'),('Small Ice','GN'),('Ice Black','GN'),
  ('Origin','GN'),('Guinness Smooth','GN'),('Malta Can','GN'),
  ('Stout Can','GN'),
  -- Existing assortment products absent from this cost list.
  ('Castle Lite',null),('Trophy',null),('Desperados',null)
on conflict do nothing;

-- Deliberately leave Desperado and the existing Desperados as distinct
-- catalogue identities pending confirmation of the exact physical variant.
update public.products p set catalogue_product_id=c.id
from public.product_catalogue c
where (p.name='"33" Export' and c.name='33')
   or (p.name='Goldberg' and c.name='Goldberg')
   or (p.name='Big Guinness Stout' and p.size='60cl' and c.name='Big Stout')
   or (p.name='Castle Lite' and c.name='Castle Lite')
   or (p.name='Trophy' and c.name='Trophy')
   or (p.name='Desperados' and c.name='Desperados');

with supplied(name, cost_price) as (values
  ('33',9100),('Goldberg',8600),('Life',8990),('Heineken',12950),
  ('Medium Heineken',18200),('Star',11400),('Gulder',11615),
  ('Legend',11200),('Medium Legend',15600),('Tiger',15500),
  ('Radler',14850),('Amstel',14060),('Maltina',14060),
  ('Desperado',21000),('Turbo',9000),('Small Turbo',12430),
  ('Goldberg Black',13700),('Fayrouz',10200),('Amstel Can',12600),
  ('Maltina Can',12600),('Maltina PET 33cl',5000),
  ('Maltina PET 50cl',8000),('Maltina PET 25cl',4490),
  ('Fayrouz Can',13290),('Heineken Can',17500),('Goldberg Can',15900),
  ('Desperados Can',22400),('Chamdor',28445),('4th Street',24185),
  ('Big Stout',15480),('Small Stout',19080),('Medium Stout',17260),
  ('Malta',13200),('Big Ice',16750),('Small Ice',16850),
  ('Ice Black',18570),('Origin',9200),('Guinness Smooth',17260),
  ('Malta Can',12500),('Stout Can',26000)
)
insert into public.product_cost_history
  (owner_user_id,catalogue_product_id,cost_price,effective_on)
select o.user_id,c.id,s.cost_price,date '2026-09-29'
from private.shop_owner o
cross join supplied s
join public.product_catalogue c on c.name=s.name
on conflict do nothing;

commit;
