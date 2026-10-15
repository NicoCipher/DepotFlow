-- M2e-1: introduce the first truly per-business owner-managed record.
-- Future owners receive an isolated business profile, NEVER the existing
-- public.shop_profile singleton that holds the legacy test shop's details.
--
-- No signup endpoint, membership provisioning, tenant checkout grant or
-- copying of test shop data is installed in this migration.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- A boolean membership predicate for a specific nonlegacy business.
-- Access is always derived from verified auth.uid() + the private registry,
-- never from user-supplied "role", a JWT business claim, or local storage.
create function private.owns_new_business(p_business_id uuid)
returns boolean
language sql stable security definer set search_path=''
as $$
  select p_business_id is not null and auth.uid() is not null and exists(
    select 1
    from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    where m.business_id=p_business_id
      and m.user_id=(select auth.uid())
      and m.member_kind='owner' and m.status='active'
      and b.status in ('setup','active')
      and b.legacy_singleton is null
  );
$$;
revoke all on function private.owns_new_business(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.owns_new_business(uuid) to authenticated;

create table public.business_profiles (
  business_id uuid primary key references private.businesses(id) on delete restrict,
  name text not null check (
    char_length(trim(name)) between 2 and 120
  ),
  address text not null default '' check (char_length(address)<=400),
  phone text not null default '' check (char_length(phone)<=40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The business ID is immutable even when the caller happens to own both
-- businesses: changing it could reassign a real depot's identity to another.
create function private.protect_business_profile_identity()
returns trigger
language plpgsql security definer set search_path=''
as $$
begin
  if old.business_id is distinct from new.business_id
     or old.created_at is distinct from new.created_at then
    raise exception 'Business identity and creation date are immutable'
      using errcode='42501';
  end if;
  new.updated_at:=now();
  return new;
end;
$$;
revoke all on function private.protect_business_profile_identity()
  from public,anon,authenticated,service_role;
create trigger business_profile_identity_guard
  before update on public.business_profiles
  for each row execute function private.protect_business_profile_identity();

alter table public.business_profiles enable row level security;
revoke all on public.business_profiles
  from public,anon,authenticated,service_role;
grant select,insert on public.business_profiles to authenticated;
grant update(name,address,phone) on public.business_profiles to authenticated;

create policy new_business_profile_select on public.business_profiles
  for select to authenticated
  using (private.owns_new_business(business_id));
create policy new_business_profile_insert on public.business_profiles
  for insert to authenticated
  with check (private.owns_new_business(business_id));
create policy new_business_profile_update on public.business_profiles
  for update to authenticated
  using (private.owns_new_business(business_id))
  with check (private.owns_new_business(business_id));

-- No DELETE grant/policy: deleting or reallocating an official identity is
-- not an ordinary checkout or settings action.
commit;
