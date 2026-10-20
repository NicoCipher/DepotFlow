-- M2f-35: tenant-aware BUSINESS PICKER for future official onboarding.
-- No signup/provisioning, no staff permissions, no legacy shop exposure.
-- Membership and profile are resolved server-side under auth.uid().
-- Separate private gate OFF + RPC ungranted until reviewed onboarding release.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.business_selection_gate (
 singleton boolean primary key default true check(singleton is true),
 enabled boolean not null default false
);
insert into private.business_selection_gate(singleton,enabled)
 values(true,false);
alter table private.business_selection_gate enable row level security;
revoke all on private.business_selection_gate from public,anon,authenticated,service_role;

create function public.list_my_businesses_for_setup()
returns table (
 business_id uuid,
 business_name text,
 business_status text,
 member_kind text
)
language plpgsql volatile security definer set search_path=''
as $business_picker$
declare
 v_actor uuid:=auth.uid();
begin
 if v_actor is null then
  raise exception 'Sign in to see your depots' using errcode='42501';
 end if;
 perform 1 from private.business_selection_gate
  where enabled is true for share;
 if not found then
  raise exception 'Multi-business setup is not yet available'
    using errcode='42501';
 end if;
 -- SECURITY DEFINER bypasses RLS, so verify EVERY row's membership and
 -- business status in the same query. Other owners, suspended businesses
 -- and the legacy shop must never appear merely through a guessed UUID.
 return query
 select b.id,
  coalesce(p.name,'Business setup not completed'::text),
  b.status,
  m.member_kind
 from private.business_memberships m
 join private.businesses b on b.id=m.business_id
 left join public.business_profiles p on p.business_id=b.id
 where m.user_id=v_actor
   and m.member_kind='owner' and m.status='active'
   and b.legacy_singleton is null
   and b.status in ('setup','active')
 order by b.created_at,b.id
 limit 100;
end;
$business_picker$;
revoke all on function public.list_my_businesses_for_setup()
 from public,anon,authenticated,service_role;
commit;
