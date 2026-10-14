-- M1 DRAFT — not an applied migration. Convert via Supabase CLI migration new
-- after Phase 1 role/tenancy review; then run isolated PostgreSQL tests.
--
-- Additive only. Existing owner-only RLS, RPCs, sales, receipts and stock
-- remain untouched. No staff user receives access from these tables.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '45s';

create table private.businesses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  status text not null default 'active'
    check (status in ('active','suspended')),
  -- Only the existing one-shop pilot can carry this marker.
  -- Unique with NULL allows future businesses to omit it.
  legacy_singleton boolean unique
    check (legacy_singleton is true)
);

create table private.business_memberships (
  business_id uuid not null references private.businesses(id)
    on delete restrict,
  user_id uuid not null references auth.users(id)
    on delete restrict,
  member_kind text not null check (member_kind in ('owner','staff')),
  status text not null default 'active'
    check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id,user_id)
);
create index business_memberships_by_user_idx
  on private.business_memberships (user_id,business_id);

-- Even signed-in users cannot create their own memberships, upgrade
-- themselves, or list arbitrary business memberships via the Data API.
alter table private.businesses enable row level security;
alter table private.business_memberships enable row level security;
revoke all on table private.businesses from public,anon,authenticated;
revoke all on table private.business_memberships from public,anon,authenticated;
-- Never create an unauthenticated or generic authenticated policy here.
-- A future business-scoped access API will be added only after RLS tests.
commit;
