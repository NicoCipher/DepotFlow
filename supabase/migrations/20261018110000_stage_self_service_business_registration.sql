-- M2f-36: verified owner self-service depot registration (STAGED/NO-GO).
-- Three registry rows (business, owner membership, profile) plus immutable
-- request audit commit atomically. No stock, customers, sale or checkout rows.
-- Every new gate starts OFF. NO authenticated/anon EXECUTE grants.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.business_registration_gate (
 singleton boolean primary key default true check(singleton is true),
 enabled boolean not null default false
);
insert into private.business_registration_gate(singleton,enabled)
 values(true,false);
alter table private.business_registration_gate enable row level security;
revoke all on private.business_registration_gate
 from public,anon,authenticated,service_role;

create table private.business_registration_requests (
 owner_id uuid not null references auth.users(id) on delete restrict,
 request_id uuid not null,
 business_id uuid not null unique references private.businesses(id) on delete restrict,
 business_name text not null,
 business_address text not null,
 business_phone text not null,
 created_at timestamptz not null default pg_catalog.now(),
 primary key(owner_id,request_id)
);
alter table private.business_registration_requests enable row level security;
revoke all on private.business_registration_requests
 from public,anon,authenticated,service_role;

-- This inexpensive sign-in eligibility checks the CURRENT auth.user row.
-- Registration requires a confirmed email, so an unconfirmed account
-- cannot obtain a depot by manipulating client-side metadata or a role.
create function public.can_register_business()
returns boolean
language plpgsql volatile security definer set search_path=''
as $eligibility$
declare
 v_actor uuid:=auth.uid();
begin
 if v_actor is null then return false; end if;
 if not exists(
  select 1 from auth.users u where u.id=v_actor
   and u.email_confirmed_at is not null
 ) then return false; end if;
 if not exists(select 1 from private.business_registration_gate
               where enabled is true)
 or not exists(select 1 from private.business_selection_gate
               where enabled is true) then
  return false;
 end if;
 -- Limit prevents casual uncontrolled spawning while businesses remain
 -- unreviewed and onboarding/activation are still disabled.
 return (
  select count(*)<3 from private.business_memberships m
  join private.businesses b on b.id=m.business_id
  where m.user_id=v_actor and m.member_kind='owner'
   and b.legacy_singleton is null
 );
end;
$eligibility$;
revoke all on function public.can_register_business()
 from public,anon,authenticated,service_role;

create function public.register_my_business(
 p_request_id uuid,p_name text,p_address text,p_phone text
) returns jsonb
language plpgsql volatile security definer set search_path=''
as $register$
declare
 v_actor uuid:=auth.uid();
 v_name text;
 v_address text;
 v_phone text;
 v_saved private.business_registration_requests%rowtype;
 v_id uuid;
begin
 if v_actor is null then
  raise exception 'Sign in to create your depot' using errcode='42501';
 end if;
 -- A current verified Auth user, NOT user-editable JWT user_metadata.
 perform 1 from auth.users u
  where u.id=v_actor and u.email_confirmed_at is not null
  for share;
 if not found then
  raise exception 'Verify your email before creating a depot'
   using errcode='42501';
 end if;
 perform 1 from private.business_registration_gate
  where enabled is true for share;
 if not found or not exists(
  select 1 from private.business_selection_gate where enabled is true
 ) then
  raise exception 'Depot registration is not available'
   using errcode='42501';
 end if;

 if p_request_id is null or p_name is null or p_address is null
  or p_phone is null then
  raise exception 'Enter the depot name and valid contact details'
   using errcode='22023';
 end if;
 v_name:=pg_catalog.btrim(pg_catalog.regexp_replace(p_name,'[[:space:]]+',' ','g'));
 v_address:=pg_catalog.btrim(pg_catalog.regexp_replace(p_address,'[[:space:]]+',' ','g'));
 v_phone:=pg_catalog.btrim(p_phone);
 if pg_catalog.length(v_name) not between 2 and 120
    or pg_catalog.length(v_address) not between 5 and 400
    or pg_catalog.length(v_phone)>40
    or v_name ~ '[[:cntrl:]]' or v_address ~ '[[:cntrl:]]'
    or v_phone ~ '[[:cntrl:]]' then
   raise exception 'Check the depot name, address and phone length'
     using errcode='22023';
 end if;

 -- A single principal can submit multiple concurrent requests. Serialize
 -- ALL registrations by owner before reading old requests and enforcing the
 -- per-owner shop cap, not just by request ID.
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('register-owner:'||v_actor::text,0)
 );
 select * into v_saved from private.business_registration_requests
  where owner_id=v_actor and request_id=p_request_id for update;
 if found then
  if v_saved.business_name is distinct from v_name
    or v_saved.business_address is distinct from v_address
    or v_saved.business_phone is distinct from v_phone then
   raise exception 'This registration request was already used with different details'
    using errcode='22023';
  end if;
  -- Revoked owners cannot recover the ID of a business they no longer own.
  if not exists(
   select 1 from private.business_memberships m
   join private.businesses b on b.id=m.business_id
   where m.user_id=v_actor and m.business_id=v_saved.business_id
    and m.member_kind='owner' and m.status='active'
    and b.legacy_singleton is null and b.status in ('setup','active')
  ) then
   raise exception 'Business is not available to this owner'
     using errcode='42501';
  end if;
  return pg_catalog.jsonb_build_object(
   'businessId',v_saved.business_id,'requestId',p_request_id,
   'businessName',v_saved.business_name,
   'status','setup','savedReplay',true,'canOperate',false
  );
 end if;

 if (select count(*) from private.business_memberships m
      join private.businesses b on b.id=m.business_id
      where m.user_id=v_actor and m.member_kind='owner'
        and b.legacy_singleton is null)>=3 then
  raise exception 'Maximum number of depots reached'
   using errcode='22023';
 end if;

 -- The GLOBAL unique normalized (name,address) index also protects
 -- against a second owner account or an edited profile claiming the same
 -- exact named physical location. Conflict requires human ownership review.
 -- This owner-specific check offers an understandable error, but the
 -- unique DB index is the actual race-safe cross-owner authority.
 -- Different physical branches can still use the same brand name.

 if exists(
  select 1 from private.business_memberships m
   join public.business_profiles p on p.business_id=m.business_id
   join private.businesses b on b.id=m.business_id
  where m.user_id=v_actor and m.member_kind='owner'
    and b.legacy_singleton is null
    and pg_catalog.lower(pg_catalog.btrim(
      pg_catalog.regexp_replace(p.name,'[[:space:]]+',' ','g')
    ))=pg_catalog.lower(v_name)
    and pg_catalog.lower(pg_catalog.btrim(
      pg_catalog.regexp_replace(p.address,'[[:space:]]+',' ','g')
    ))=pg_catalog.lower(v_address)
 ) then
   raise exception 'You have already registered this depot'
    using errcode='22023';
 end if;

 insert into private.businesses(status) values('setup') returning id into v_id;
 insert into private.business_memberships(
  business_id,user_id,member_kind,status
 ) values(v_id,v_actor,'owner','active');
 insert into public.business_profiles(
  business_id,name,address,phone
 ) values(v_id,v_name,v_address,v_phone);
 insert into private.business_registration_requests(
  owner_id,request_id,business_id,business_name,business_address,business_phone
 ) values(v_actor,p_request_id,v_id,v_name,v_address,v_phone);

 return pg_catalog.jsonb_build_object(
  'businessId',v_id,'requestId',p_request_id,
  'businessName',v_name,'status','setup',
  'savedReplay',false,'canOperate',false
 );
end;
$register$;
revoke all on function public.register_my_business(uuid,text,text,text)
 from public,anon,authenticated,service_role;
commit;
