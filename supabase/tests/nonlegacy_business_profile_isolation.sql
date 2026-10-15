-- M2e-1 tenant profile isolation acceptance test.
-- No migration touches live registrations or business records; rollback only.
begin;
insert into auth.users(id) values
 ('89200000-0000-4000-8000-000000000001'),
 ('89200000-0000-4000-8000-000000000002'),
 ('89200000-0000-4000-8000-000000000003'),
 ('89200000-0000-4000-8000-000000000004');
insert into private.shop_owner(user_id)
values ('89200000-0000-4000-8000-000000000004');
select private.link_legacy_shop_business();
insert into public.shop_profile(id,name,address,phone)
values (true,'Existing test depot','Old street','08000000000');

-- Two independent new-business owners, plus a suspended third shop.
insert into private.businesses(id,status)
values
 ('89200000-0000-4000-9000-000000000011','setup'),
 ('89200000-0000-4000-9000-000000000012','active'),
 ('89200000-0000-4000-9000-000000000013','suspended');
insert into private.business_memberships(business_id,user_id,status,member_kind)
values
 ('89200000-0000-4000-9000-000000000011',
  '89200000-0000-4000-8000-000000000001','active','owner'),
 ('89200000-0000-4000-9000-000000000012',
  '89200000-0000-4000-8000-000000000002','active','owner'),
 ('89200000-0000-4000-9000-000000000013',
  '89200000-0000-4000-8000-000000000003','active','owner');

create function pg_temp.assert_is(p_success boolean,p_msg text)
returns void language plpgsql as $$
begin
 if p_success is distinct from true then raise exception '%',p_msg;end if;
end;
$$;

do $privileges$
begin
 if has_table_privilege('anon','public.business_profiles','SELECT')
  or has_table_privilege('anon','public.business_profiles','INSERT')
  or has_table_privilege('authenticated','public.business_profiles','DELETE')
  or has_column_privilege('authenticated','public.business_profiles','business_id','UPDATE')
  or has_column_privilege('authenticated','public.business_profiles','created_at','UPDATE')
  or has_column_privilege('authenticated','public.business_profiles','created_at','INSERT')
  or has_column_privilege('authenticated','public.business_profiles','updated_at','INSERT')
  or has_table_privilege('authenticated','private.business_memberships','SELECT')
  or not has_function_privilege('authenticated','private.owns_new_business(uuid)','EXECUTE') then
   raise exception 'Cross-business table/identity permissions are unsafe';
 end if;
end;
$privileges$;

set local role authenticated;
select set_config('request.jwt.claim.sub','89200000-0000-4000-8000-000000000001',true);
select pg_temp.assert_is(
  private.owns_new_business('89200000-0000-4000-9000-000000000011')
  and not private.owns_new_business('89200000-0000-4000-9000-000000000012'),
  'Owner A is missing or could claim owner B business');
insert into public.business_profiles(business_id,name,address,phone)
values ('89200000-0000-4000-9000-000000000011','Owner A Shop','A road','08000000001');
-- The DB, never the browser, owns both created/updated timestamps.
do $timestamp_attack$
begin
  begin
    insert into public.business_profiles(
      business_id,name,created_at,updated_at
    ) values (
      '89200000-0000-4000-9000-000000000012',
      'Forged timestamp', '2020-01-01'::timestamptz,
      '2020-01-01'::timestamptz
    );
    raise exception 'Client supplied arbitrary business profile timestamps'
      using errcode='PT001';
  exception when insufficient_privilege then null;
  end;
end;
$timestamp_attack$;
select pg_temp.assert_is(
 (select count(*)=1 from public.business_profiles where
 business_id='89200000-0000-4000-9000-000000000011'
 and created_at is not null and updated_at is not null),
 'Business profile server timestamps missing'
);
select pg_temp.assert_is(
 (select count(*)=1 from public.business_profiles)
 and not public.is_shop_owner()
 and not exists(select 1 from public.shop_profile),
 'New shop owner can see legacy records or is missing own profile');

-- A cannot insert a forged row into B, nor change its immutable business ID.
do $forgery$
begin
 begin
   insert into public.business_profiles(business_id,name)
   values ('89200000-0000-4000-9000-000000000012','Forged business');
   raise exception 'Cross-business profile INSERT accepted' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
   update public.business_profiles
     set business_id='89200000-0000-4000-9000-000000000012'
   where business_id='89200000-0000-4000-9000-000000000011';
   raise exception 'Cross-business profile reassignment accepted'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
   delete from public.business_profiles
   where business_id='89200000-0000-4000-9000-000000000011';
   raise exception 'Ordinary owner could delete business identity'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$forgery$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','89200000-0000-4000-8000-000000000002',true);
insert into public.business_profiles(business_id,name,address,phone)
values ('89200000-0000-4000-9000-000000000012','Owner B Shop','B road','08000000002');
select pg_temp.assert_is(
 (select count(*)=1 from public.business_profiles)
 and (select name='Owner B Shop' from public.business_profiles limit 1)
 and not exists(select 1 from public.shop_profile),
 'Owner B saw A profile or original test shop');
update public.business_profiles set name='Owner B Updated'
where business_id='89200000-0000-4000-9000-000000000012';
select pg_temp.assert_is(
 (select name='Owner B Updated' from public.business_profiles),
 'Own business settings could not be edited');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub','89200000-0000-4000-8000-000000000001',true);
select pg_temp.assert_is(
 (select count(*)=1 from public.business_profiles)
 and (select name='Owner A Shop' from public.business_profiles),
 'Updating business B changed A records');
reset role;

-- Losing membership must immediately remove the owner's own profile access.
update private.business_memberships set status='disabled'
where business_id='89200000-0000-4000-9000-000000000011';
set local role authenticated;
select set_config('request.jwt.claim.sub','89200000-0000-4000-8000-000000000001',true);
select pg_temp.assert_is(
 not private.owns_new_business('89200000-0000-4000-9000-000000000011')
 and not exists(select 1 from public.business_profiles),
 'Disabled owner still accesses business profile');
reset role;

-- An ACTIVE member is insufficient when the business itself is suspended.
set local role authenticated;
select set_config('request.jwt.claim.sub','89200000-0000-4000-8000-000000000003',true);
select pg_temp.assert_is(
 not private.owns_new_business('89200000-0000-4000-9000-000000000013'),
 'Suspended business owner retained access');
do $suspended$
begin
 begin
   insert into public.business_profiles(business_id,name)
   values ('89200000-0000-4000-9000-000000000013','Suspended Shop');
   raise exception 'Suspended business created profile' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$suspended$;
reset role;

-- Original pilot owner remains authenticated to its ORIGINAL profile only.
set local role authenticated;
select set_config('request.jwt.claim.sub','89200000-0000-4000-8000-000000000004',true);
select pg_temp.assert_is(
 public.is_shop_owner() and
 (select name='Existing test depot' from public.shop_profile) and
 not exists(select 1 from public.business_profiles),
 'Original pilot reads were replaced by new-business records');
reset role;

do $data_unchanged$
begin
 if (select count(*) from public.business_profiles)<>2
    or (select name from public.shop_profile where id=true)<>'Existing test depot'
    or (select name from public.business_profiles
        where business_id='89200000-0000-4000-9000-000000000011')<>'Owner A Shop'
    or (select name from public.business_profiles
        where business_id='89200000-0000-4000-9000-000000000012')<>'Owner B Updated' then
    raise exception 'Cross-business operation modified other business records';
 end if;
end;
$data_unchanged$;
rollback;
