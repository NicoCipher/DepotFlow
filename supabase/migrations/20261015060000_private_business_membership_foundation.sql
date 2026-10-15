begin;

-- Additive M1 only. No owner login or tenant policies change here.
-- These tables cannot grant access to existing sales/customer/stock data.
set local lock_timeout = '5s';
set local statement_timeout = '45s';

create table private.businesses (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'setup'
    check (status in ('setup', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  -- One legacy shop may be marked for a subsequent verified owner backfill.
  -- Future businesses must leave this NULL.
  legacy_singleton boolean unique check (legacy_singleton is distinct from false)
);

create table private.business_memberships (
  business_id uuid not null references private.businesses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  member_kind text not null default 'owner' check (member_kind = 'owner'),
  status text not null default 'disabled'
    check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create index business_memberships_by_user_idx
  on private.business_memberships (user_id, business_id);

-- This stage deliberately creates no SELECT/INSERT/UPDATE/DELETE policy.
-- V1 permits an owner per business only. Staff roles/invites are later migrations.
-- Even an authenticated user with a valid session has no direct data access.
alter table private.businesses enable row level security;
alter table private.business_memberships enable row level security;
revoke all on table private.businesses from public, anon, authenticated;
revoke all on table private.business_memberships from public, anon, authenticated;

-- Critical compatibility fence: private.shop_owner and is_shop_owner()
-- remain unchanged. No new staff or shop can log into the old ledger.
commit;
