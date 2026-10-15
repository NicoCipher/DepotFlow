-- M1 foundation regression. Disposable PostgreSQL only; all changes roll back.
begin;
insert into auth.users(id) values
 ('80000000-0000-4000-8000-000000000001'),
 ('80000000-0000-4000-8000-000000000002');
insert into private.shop_owner(user_id)
values ('80000000-0000-4000-8000-000000000001');

insert into private.businesses(id,status,legacy_singleton)
values ('80000000-0000-4000-9000-000000000001','active',true);
insert into private.businesses(id,status)
values ('80000000-0000-4000-9000-000000000002','setup');

insert into private.business_memberships(business_id,user_id,member_kind,status)
values ('80000000-0000-4000-9000-000000000001',
        '80000000-0000-4000-8000-000000000001','owner','active');
-- A second owner registration cannot activate itself by simply having a row.
insert into private.business_memberships(business_id,user_id,member_kind)
values ('80000000-0000-4000-9000-000000000002',
        '80000000-0000-4000-8000-000000000002','owner');

do $$
begin
  if exists(select 1 from private.business_memberships
       where member_kind <> 'owner') then
    raise exception 'V1 may not contain any staff membership';
  end if;
  begin
    update private.business_memberships set member_kind='staff'
      where business_id='80000000-0000-4000-9000-000000000002';
    raise exception 'V1 accepted a staff membership';
  exception when check_violation then null;
  end;
  if (select count(*) from private.business_memberships where status='disabled') <> 1 then
    raise exception 'New memberships must default to disabled';
  end if;
  if not (select relrowsecurity from pg_class where oid='private.businesses'::regclass)
    or not (select relrowsecurity from pg_class where oid='private.business_memberships'::regclass) then
    raise exception 'RLS missing on private business tables';
  end if;
  if has_table_privilege('authenticated','private.businesses','SELECT')
    or has_table_privilege('authenticated','private.businesses','INSERT')
    or has_table_privilege('authenticated','private.businesses','UPDATE')
    or has_table_privilege('authenticated','private.businesses','DELETE')
    or has_table_privilege('authenticated','private.business_memberships','SELECT')
    or has_table_privilege('authenticated','private.business_memberships','INSERT')
    or has_table_privilege('authenticated','private.business_memberships','UPDATE')
    or has_table_privilege('authenticated','private.business_memberships','DELETE')
    or has_table_privilege('anon','private.businesses','SELECT')
    or has_table_privilege('anon','private.businesses','INSERT')
    or has_table_privilege('anon','private.businesses','UPDATE')
    or has_table_privilege('anon','private.businesses','DELETE')
    or has_table_privilege('anon','private.business_memberships','SELECT')
    or has_table_privilege('anon','private.business_memberships','INSERT')
    or has_table_privilege('anon','private.business_memberships','UPDATE')
    or has_table_privilege('anon','private.business_memberships','DELETE') then
    raise exception 'Private business data accidentally granted to clients';
  end if;
  if exists(
    select 1 from pg_policies
    where schemaname='private'
      and tablename in ('businesses','business_memberships')
  ) then
    raise exception 'M1 must not expose policies to users';
  end if;
  if (select count(*) from private.businesses where legacy_singleton is true) <> 1 then
    raise exception 'Expected exactly one marked legacy business';
  end if;
end $$;

-- Preserve the current owner-only login gate without granting access
-- to the new private business tables.
select set_config('request.jwt.claim.sub',
  '80000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
begin
  if not public.is_shop_owner() then
    raise exception 'M1 unexpectedly broke existing owner access';
  end if;
  begin
    perform count(*) from private.businesses;
    raise exception 'Authenticated clients could read private businesses';
  exception when insufficient_privilege then null;
  end;
  begin
    update private.businesses set status='active';
    raise exception 'Authenticated client could change another business';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from private.businesses;
    raise exception 'Authenticated client could delete businesses';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into private.business_memberships
      (business_id,user_id,member_kind,status)
    values ('80000000-0000-4000-9000-000000000002',
            auth.uid(),'owner','active');
    raise exception 'Authenticated clients could self-grant an owner membership';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claim.sub',
  '80000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$
begin
  if public.is_shop_owner() then
    raise exception 'Second logged-in user entered the legacy shop';
  end if;
  begin
    perform count(*) from private.business_memberships;
    raise exception 'Second logged-in user could read business memberships';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $anonymous$
begin
  begin
    perform count(*) from private.businesses;
    raise exception 'Anonymous role could read the business registry';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into private.businesses(status) values('setup');
    raise exception 'Anonymous role could create a business';
  exception when insufficient_privilege then null;
  end;
  begin
    update private.business_memberships
       set status='active';
    raise exception 'Anonymous role could modify memberships';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from private.business_memberships;
    raise exception 'Anonymous role could delete memberships';
  exception when insufficient_privilege then null;
  end;
end $anonymous$;
reset role;

-- IDs and balances in the existing shop are never edited by this migration.
rollback;
