-- M1b: never copy test business data into a new real business.
-- Runs against a disposable PostgreSQL test DB; always rolls back.
begin;

do $$
begin
  if private.link_legacy_shop_business() is not null then
    raise exception 'Fresh database should not receive legacy shop identity';
  end if;
  if exists(select 1 from private.businesses where legacy_singleton is true)
    then raise exception 'Ownerless migration invented a legacy business';
  end if;
end $$;

insert into auth.users(id)
values ('85000000-0000-4000-8000-000000000001'),
       ('85000000-0000-4000-8000-000000000002');
insert into private.shop_owner(user_id)
values ('85000000-0000-4000-8000-000000000001');

do $$
declare
  v_business uuid;
  v_again uuid;
  v_status text;
begin
  v_business := private.link_legacy_shop_business();
  if v_business is null then
    raise exception 'Owner mapping missing';
  end if;
  v_again := private.link_legacy_shop_business();
  if v_again is distinct from v_business then
    raise exception 'Repeated backfill created another business';
  end if;
  if (select count(*) from private.businesses) <> 1
    or (select count(*) from private.business_memberships) <> 1 then
    raise exception 'Legacy backfill duplicated a membership or business';
  end if;
  if not exists (
    select 1 from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    where m.user_id='85000000-0000-4000-8000-000000000001'
    and m.member_kind='owner' and m.status='active'
    and b.id=v_business and b.legacy_singleton is true
    and b.status='active'
  ) then raise exception 'Original shop owner was not mapped';
  end if;

  update private.business_memberships set status='disabled'
    where business_id=v_business;
  begin
    perform private.link_legacy_shop_business();
    raise exception 'Disabled membership was silently revived'
      using errcode='PT001';
  exception when SQLSTATE 'P0001' then null;
  end;
  update private.business_memberships set status='active'
    where business_id=v_business;
  begin
    insert into private.business_memberships
      (business_id,user_id,member_kind,status)
    values (v_business,'85000000-0000-4000-8000-000000000002',
            'owner','active');
    raise exception 'A second owner was accepted'
      using errcode='PT001';
  exception when unique_violation then null;
  end;
  if (select count(*) from private.business_memberships
      where business_id=v_business) <> 1 then
    raise exception 'Database failed to reject second owner';
  end if;
  -- A previously mapped legacy owner must not be seeded into another
  -- business, whether the other membership is active or disabled.
  insert into private.businesses(id,status)
  values('85000000-0000-4000-9000-000000000020','setup');
  for v_status in select unnest(array['active','disabled']) loop
    insert into private.business_memberships
      (business_id,user_id,member_kind,status)
    values('85000000-0000-4000-9000-000000000020',
           '85000000-0000-4000-8000-000000000001',
           'owner',v_status);
    begin
      perform private.link_legacy_shop_business();
      raise exception 'Existing owner mapping outside legacy shop accepted'
        using errcode='PT001';
    exception when SQLSTATE 'P0001' then null;
    end;
    delete from private.business_memberships
    where business_id='85000000-0000-4000-9000-000000000020';
  end loop;
  delete from private.businesses
    where id='85000000-0000-4000-9000-000000000020';
  if private.link_legacy_shop_business() is distinct from v_business then
    raise exception 'Recovered mapping changed identity';
  end if;
end $$;

-- No new privileged RPC: the private admin seed is never executable by
-- anonymous or authenticated browser clients.
do $$
begin
  if has_function_privilege('anon',
       'private.link_legacy_shop_business()', 'EXECUTE')
    or has_function_privilege('authenticated',
       'private.link_legacy_shop_business()', 'EXECUTE') then
    raise exception 'Admin-only owner seeding exposed to clients';
  end if;
  if not (select relrowsecurity from pg_class
          where oid='private.business_memberships'::regclass) then
    raise exception 'Membership isolation was weakened';
  end if;
end $$;

do $$
begin
  perform set_config('request.jwt.claim.sub',
    '85000000-0000-4000-8000-000000000001',true);
end $$;
set local role authenticated;
do $$
begin
  if not public.is_shop_owner() then
    raise exception 'Legacy owner lost owner-only access';
  end if;
  begin
    perform private.link_legacy_shop_business();
    raise exception 'Browser account could run admin-only linking'
      using errcode='PT001';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$
begin
  perform set_config('request.jwt.claim.sub',
    '85000000-0000-4000-8000-000000000002',true);
end $$;
set local role authenticated;
do $$
begin
  if public.is_shop_owner() then
    raise exception 'Other identity entered the existing shop';
  end if;
end $$;
reset role;
rollback;
