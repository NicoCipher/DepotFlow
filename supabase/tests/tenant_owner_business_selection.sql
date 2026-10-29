-- Rollback-only tenant-aware owner business picker with separate owners
-- and the same owner managing TWO businesses. No production grants.
begin;
insert into auth.users(id) values
 ('89e00000-0000-4000-8000-000000000001'),
 ('89e00000-0000-4000-8000-000000000002'),
 ('89e00000-0000-4000-8000-000000000003'),
 ('89e00000-0000-4000-8000-000000000004');
insert into private.shop_owner(user_id)
 values('89e00000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
insert into private.businesses(id,status) values
 ('89e00000-0000-4000-9000-000000000021','setup'),
 ('89e00000-0000-4000-9000-000000000022','active'),
 ('89e00000-0000-4000-9000-000000000023','setup'),
 ('89e00000-0000-4000-9000-000000000024','suspended');
insert into private.business_memberships(
 business_id,user_id,status,member_kind
) values
 ('89e00000-0000-4000-9000-000000000021',
  '89e00000-0000-4000-8000-000000000002','active','owner'),
 ('89e00000-0000-4000-9000-000000000022',
  '89e00000-0000-4000-8000-000000000002','active','owner'),
 ('89e00000-0000-4000-9000-000000000023',
  '89e00000-0000-4000-8000-000000000003','active','owner'),
 ('89e00000-0000-4000-9000-000000000024',
  '89e00000-0000-4000-8000-000000000004','active','owner');
insert into public.business_profiles(business_id,name,address,phone)
 values
 ('89e00000-0000-4000-9000-000000000021',
  'Owner A first depot','Yaba','08005550021'),
 ('89e00000-0000-4000-9000-000000000022',
  'Owner A second depot','Ikeja','08005550022'),
 ('89e00000-0000-4000-9000-000000000023',
  'Private competitor depot','Lagos','08005550023');

do $default_off$
begin
 if (select enabled from private.business_selection_gate)
 or has_function_privilege('anon',
   'public.list_my_businesses_for_setup()','EXECUTE') then
  raise exception 'Business picker gate exposed by default';
 end if;
end;
$default_off$;

grant execute on function public.list_my_businesses_for_setup()
 to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89e00000-0000-4000-8000-000000000002',true);
do $gate_off$
begin
 begin
  perform * from public.list_my_businesses_for_setup();
  raise exception 'Owner escaped disabled picker gate' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$gate_off$;
reset role;
update private.business_selection_gate set enabled=true where singleton;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89e00000-0000-4000-8000-000000000002',true);
do $a_two_depots$
declare v_count int;v_names text[];
begin
 select count(*),array_agg(business_name order by business_id)
 into v_count,v_names from public.list_my_businesses_for_setup();
 if v_count<>2
 or v_names is distinct from array[
    'Owner A first depot','Owner A second depot'
  ] then
  raise exception 'Owner A picker leaked another depot: %, %',v_count,v_names;
 end if;
end;
$a_two_depots$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89e00000-0000-4000-8000-000000000003',true);
do $separate_owner$
declare v_name text;v_count int;
begin
 select count(*),min(business_name) into v_count,v_name
 from public.list_my_businesses_for_setup();
 if v_count<>1 or v_name<>'Private competitor depot' then
  raise exception 'Competitor picker leaked unrelated business';
 end if;
end;
$separate_owner$;
reset role;

-- A suspended business and a disabled membership are excluded instantly.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89e00000-0000-4000-8000-000000000004',true);
do $suspended_business$
begin
 if exists(select 1 from public.list_my_businesses_for_setup()) then
  raise exception 'Suspended business shown in owner picker';
 end if;
end;
$suspended_business$;
reset role;
update private.business_memberships set status='disabled'
 where business_id='89e00000-0000-4000-9000-000000000022';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89e00000-0000-4000-8000-000000000002',true);
do $disabled_membership$
begin
 if (select count(*) from public.list_my_businesses_for_setup())<>1 then
  raise exception 'Disabled second membership still shown';
 end if;
end;
$disabled_membership$;
reset role;

-- Existing single-shop owners remain on their existing flow. The
-- legacy business must not appear as a new-v1 onboarding account.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89e00000-0000-4000-8000-000000000001',true);
do $legacy_only$
begin
 if exists(select 1 from public.list_my_businesses_for_setup()) then
  raise exception 'Original shop was mistakenly exposed as a new depot';
 end if;
end;
$legacy_only$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89e00000-0000-4000-8000-000000000004',true);
do $anonymous_session$
begin
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform * from public.list_my_businesses_for_setup();
  raise exception 'Missing auth principal exposed picker' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$anonymous_session$;
reset role;
rollback;
