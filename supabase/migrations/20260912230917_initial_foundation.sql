begin;

-- One owner, provisioned by a database administrator. Never writable via the API.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
create table private.shop_owner (
  singleton boolean primary key default true check (singleton),
  user_id uuid not null unique references auth.users(id)
);
alter table private.shop_owner enable row level security;
revoke all on private.shop_owner from public, anon, authenticated;
grant select on private.shop_owner to authenticated;
create policy owner_can_read_own_configuration on private.shop_owner
  for select to authenticated using (user_id = (select auth.uid()));

-- Type identifiers are independent opaque labels. A family is presentation only;
-- sharing a family does NOT establish crate or bottle compatibility.
create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  size text,
  image_url text,
  bottles_per_crate integer not null check (bottles_per_crate > 0),
  full_crate_price integer not null check (full_crate_price >= 0),
  half_crate_price integer check (half_crate_price >= 0),
  quarter_crate_price integer check (quarter_crate_price >= 0),
  bottle_price integer check (bottle_price >= 0),
  bottles_returnable boolean not null,
  empty_family text,
  crate_type text not null check (length(btrim(crate_type)) > 0),
  bottle_type text check (length(btrim(bottle_type)) > 0),
  created_at timestamptz not null default now(),
  check (not bottles_returnable or bottle_type is not null)
);
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  phone text not null check (length(btrim(phone)) > 0),
  created_at timestamptz not null default now()
);
create table public.stock (
  product_id uuid primary key references public.products(id),
  total_bottles integer not null default 0 check (total_bottles >= 0)
);
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  total_amount integer not null check (total_amount >= 0),
  paid_amount integer not null check (paid_amount >= 0 and paid_amount <= total_amount),
  created_at timestamptz not null default now()
);
create index sales_customer_id_idx on public.sales(customer_id);
create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id),
  product_id uuid not null references public.products(id),
  product_name text not null,
  total_bottles integer not null check (total_bottles > 0),
  bottles_per_crate integer not null check (bottles_per_crate > 0),
  line_total integer not null check (line_total >= 0),
  bottles_returnable boolean not null,
  crate_type text not null,
  bottle_type text,
  crates_out integer generated always as (total_bottles / bottles_per_crate) stored,
  returnable_bottles_out integer generated always as
    (case when bottles_returnable then total_bottles else 0 end) stored,
  check (not bottles_returnable or bottle_type is not null)
);
create index sale_items_sale_id_idx on public.sale_items(sale_id);
create index sale_items_product_id_idx on public.sale_items(product_id);

-- Current balances, deliberately separate. Later saves/repayments must update
-- these within the same database transaction as their source records.
create table public.money_owed (
  customer_id uuid primary key references public.customers(id),
  amount integer not null default 0 check (amount >= 0)
);
create table public.deposits (
  customer_id uuid primary key references public.customers(id),
  amount integer not null default 0 check (amount >= 0)
);
create table public.crate_obligations (
  customer_id uuid not null references public.customers(id),
  crate_type text not null check (length(btrim(crate_type)) > 0),
  quantity integer not null default 0 check (quantity >= 0),
  primary key (customer_id, crate_type)
);
create table public.bottle_obligations (
  customer_id uuid not null references public.customers(id),
  bottle_type text not null check (length(btrim(bottle_type)) > 0),
  quantity integer not null default 0 check (quantity >= 0),
  primary key (customer_id, bottle_type)
);
create table public.empty_crate_stock (
  crate_type text primary key check (length(btrim(crate_type)) > 0),
  quantity integer not null default 0 check (quantity >= 0)
);
create table public.empty_bottle_stock (
  bottle_type text primary key check (length(btrim(bottle_type)) > 0),
  quantity integer not null default 0 check (quantity >= 0)
);

-- Foundation is read-only through the Data API, including for the owner.
-- No partial sale writes are possible. Add a validated atomic database operation
-- before enabling sale/stock/balance mutations; never grant blanket table writes.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'products', 'customers', 'sales', 'sale_items', 'stock', 'money_owed',
    'crate_obligations', 'bottle_obligations', 'deposits',
    'empty_crate_stock', 'empty_bottle_stock'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on public.%I from public, anon, authenticated', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format(
      'create policy owner_read on public.%I for select to authenticated using
       (exists (select 1 from private.shop_owner where user_id = (select auth.uid())))',
      table_name
    );
  end loop;
end $$;
commit;
