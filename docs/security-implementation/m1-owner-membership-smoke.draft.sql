-- M1 DRAFT SMOKE TEST — run ONLY against isolated migrated DB,
-- after owner backfill, as a trusted database test administrator.
-- Read-only assertions + expected rejected table reads and writes.
begin;
set local statement_timeout = '30s';
do $$
declare v_business uuid; v_owner uuid;
begin
  if (select count(*) from private.shop_owner) <> 1 then
    raise exception 'Test requires one configured original owner';
  end if;
  select id into v_business
  from private.businesses where legacy_singleton is true;
  select user_id into v_owner from private.shop_owner;
  if v_business is null or v_owner is null then
    raise exception 'Legacy owner/business mapping is missing';
  end if;
  if (select count(*) from private.business_memberships
      where business_id=v_business and user_id=v_owner
      and member_kind='owner' and status='active') <> 1 then
    raise exception 'Legacy owner membership was not seeded correctly';
  end if;
  if (select count(*) from private.business_memberships) <> 1 then
    raise exception 'M1 unexpectedly activated additional memberships';
  end if;
  if has_table_privilege('authenticated','private.businesses','SELECT')
    or has_table_privilege('authenticated','private.business_memberships','SELECT')
    or has_table_privilege('authenticated','private.business_memberships','INSERT')
    or has_table_privilege('authenticated','private.business_memberships','UPDATE')
    or has_table_privilege('authenticated','private.business_memberships','DELETE')
    or has_table_privilege('anon','private.businesses','SELECT')
    or has_table_privilege('anon','private.business_memberships','INSERT') then
    raise exception 'Direct database grants expose private membership data';
  end if;
  if not (select relrowsecurity from pg_class
      where oid='private.businesses'::regclass)
    or not (select relrowsecurity from pg_class
      where oid='private.business_memberships'::regclass) then
    raise exception 'Private M1 tables must have RLS enabled';
  end if;
end $$;

-- Test the originally provisioned owner can still use the legacy login gate.
select set_config('request.jwt.claim.sub',
  (select user_id::text from private.shop_owner),true);
set local role authenticated;
do $$
begin
  if not public.is_shop_owner() then
    raise exception 'The existing owner sign-in gate was broken';
  end if;
  begin
    perform count(*) from private.business_memberships;
    raise exception 'Authenticated user can read private memberships';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into private.business_memberships
      (business_id,user_id,member_kind,status)
    values (gen_random_uuid(),auth.uid(),'owner','active');
    raise exception 'Authenticated user can self-grant owner membership';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
