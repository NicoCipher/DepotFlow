-- M1 DRAFT OWNER BACKFILL — admin-only, not run on production.
-- Run AFTER the reviewed private.businesses/business_memberships migration.
-- Abort if no configured owner: unlike a blank test DB, the production pilot
-- must have exactly one verified owner.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$
declare
  v_owner uuid;
  v_count integer;
  v_business uuid;
begin
  select count(*), max(user_id)
    into v_count,v_owner from private.shop_owner;
  if v_count <> 1 or v_owner is null then
    raise exception 'Legacy owner mapping failed preflight'
      using errcode='P0001';
  end if;
  if not exists (select 1 from auth.users where id=v_owner) then
    raise exception 'Legacy registered owner has no Auth identity'
      using errcode='P0001';
  end if;

  select id into v_business
  from private.businesses
  where legacy_singleton is true
  for update;

  if v_business is null then
    insert into private.businesses(legacy_singleton)
    values(true) returning id into v_business;
  end if;

  insert into private.business_memberships
    (business_id,user_id,member_kind,status)
  values (v_business,v_owner,'owner','active')
  on conflict (business_id,user_id) do nothing;

  -- Never silently revive or upgrade an altered membership on retry.
  if not exists (
    select 1 from private.business_memberships m
    where m.business_id=v_business
      and m.user_id=v_owner
      and m.member_kind='owner'
      and m.status='active'
  ) then
    raise exception 'Legacy membership exists but is not an active owner'
      using errcode='P0001';
  end if;

  if (select count(*) from private.businesses
      where legacy_singleton is true) <> 1 then
    raise exception 'Ambiguous legacy shop mapping'
      using errcode='P0001';
  end if;
end $$;
commit;
