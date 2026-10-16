begin;
-- M1b: associate the EXISTING owner-only test workspace with a business
-- identity. No shop data moves and nobody gains access through this mapping.
set local lock_timeout='5s';
set local statement_timeout='45s';

-- Administrator-only and SECURITY INVOKER. The private schema is not exposed
-- to the REST API, and anon/authenticated never receive EXECUTE.
create function private.link_legacy_shop_business()
returns uuid
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_owner_count integer;
  v_owner uuid;
  v_business uuid;
begin
  -- Serialize two concurrent administrator retries, including first insert.
  perform pg_catalog.pg_advisory_xact_lock(81015, 610);
  select count(*) into v_owner_count from private.shop_owner;
  if v_owner_count = 0 then
    -- A fresh isolated database has no manually provisioned legacy owner.
    -- Do not invent one or create an empty business.
    if exists (select 1 from private.businesses
               where legacy_singleton is true) then
      raise exception 'Legacy business marker exists without configured owner';
    end if;
    return null;
  end if;
  if v_owner_count <> 1 then
    raise exception 'Ambiguous legacy owner';
  end if;
  select user_id into strict v_owner from private.shop_owner for update;
  if not exists (select 1 from auth.users where id = v_owner) then
    raise exception 'Legacy owner has no verified Auth user';
  end if;

  select id into v_business from private.businesses
  where legacy_singleton is true for update;
  -- In owner-only V1, a registered legacy owner cannot quietly become
  -- owner of another business. Require a separate audited migration instead.
  -- If this is a retry, only the original active legacy membership is valid.
  if exists (
    select 1 from private.business_memberships m
    where m.user_id=v_owner
      and (
        v_business is null
        or m.business_id <> v_business
        or m.member_kind <> 'owner'
        or m.status <> 'active'
      )
  ) then
    raise exception 'Legacy owner already mapped to another or inactive business';
  end if;
  if v_business is null then
    insert into private.businesses(status,legacy_singleton)
    values('active',true)
    returning id into v_business;
  end if;
  -- The existing test shop is already in use. Never flip an archived or
  -- suspended marker to active just because a seed script was replayed.
  if not exists (
    select 1 from private.businesses
    where id=v_business and status='active' and legacy_singleton is true
  ) then
    raise exception 'Legacy business marker is not active';
  end if;

  insert into private.business_memberships
    (business_id,user_id,member_kind,status)
  values (v_business,v_owner,'owner','active')
  on conflict (business_id,user_id) do nothing;

  if (select count(*) from private.business_memberships
      where business_id=v_business) <> 1
     or not exists(
       select 1 from private.business_memberships
       where business_id=v_business and user_id=v_owner
         and member_kind='owner' and status='active'
     ) then
    raise exception 'Legacy membership is not exactly one active owner';
  end if;

  return v_business;
end;
$$;

revoke all on function private.link_legacy_shop_business()
  from public, anon, authenticated;

-- Safe when a fresh CI database has zero owner rows; on the existing pilot
-- this creates ONE separate identity for the test workspace.
select private.link_legacy_shop_business();
commit;
