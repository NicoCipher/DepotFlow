-- M2f-45: complete the global customer primary-key collision fix.
-- Removing new-depot INSERT(business_id) alone left old Walnik callers able
-- to supply arbitrary id in a legacy INSERT, probing new-depot UUIDs through
-- the global customers PK. Move legacy creation to a verified server-generated
-- ID RPC; retain existing legacy UPDATE and SELECT paths.
--
-- New RPC checks original shop owner and active membership where legacy
-- write scope is enabled; exact request replay is immutable and safe.
-- The JWT/user_metadata never determines original-shop ownership.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.legacy_customer_creation_requests (
 owner_id uuid not null references auth.users(id) on delete restrict,
 request_id uuid not null,
 customer_id uuid not null unique references public.customers(id) on delete restrict,
 customer_name text not null,
 customer_phone text not null,
 customer_business_name text,
 customer_address text,
 created_at timestamptz not null default pg_catalog.now(),
 primary key(owner_id,request_id)
);
alter table private.legacy_customer_creation_requests enable row level security;
revoke all on private.legacy_customer_creation_requests
 from public,anon,authenticated,service_role;

create function public.create_legacy_customer(
 p_request_id uuid,
 p_name text,
 p_phone text,
 p_business_name text,
 p_address text
) returns jsonb
language plpgsql volatile security definer set search_path=''
as $legacy_create$
declare
 v_actor uuid:=auth.uid();
 v_legacy_business uuid;
 v_name text;
 v_phone text;
 v_business_name text;
 v_address text;
 v_existing private.legacy_customer_creation_requests%rowtype;
 v_customer_id uuid;
begin
 if v_actor is null then
  raise exception 'Original shop owner sign-in required' using errcode='42501';
 end if;
 -- Hold original owner identity lock before resolving any stored response.
 perform 1 from private.shop_owner o
   where o.user_id=v_actor for share;
 if not found then
  raise exception 'Only the verified original shop owner can add customers'
   using errcode='42501';
 end if;

 -- If business scoping has been activated, enforce the exact same active
 -- original owner membership as its operational-write trigger.
 select g.business_id into v_legacy_business
   from private.legacy_write_scope_gate g
   where g.enabled is true for share;
 if v_legacy_business is not null then
  perform 1 from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    where m.user_id=v_actor and m.business_id=v_legacy_business
      and m.member_kind='owner' and m.status='active'
      and b.legacy_singleton is true and b.status='active'
    for share of m,b;
  if not found then
   raise exception 'Original shop owner is no longer active'
    using errcode='42501';
  end if;
 end if;

 if p_request_id is null or p_name is null or p_phone is null then
  raise exception 'Customer request and identity are required'
    using errcode='22023';
 end if;
 v_name:=pg_catalog.btrim(
  pg_catalog.regexp_replace(p_name,'[[:space:]]+',' ','g'));
 v_phone:=pg_catalog.btrim(p_phone);
 v_business_name:=nullif(pg_catalog.btrim(
  pg_catalog.regexp_replace(coalesce(p_business_name,''),'[[:space:]]+',' ','g')),'');
 v_address:=nullif(pg_catalog.btrim(coalesce(p_address,'')),'');
 if pg_catalog.length(v_name) not between 1 and 120
 or v_phone !~ '^\+?[0-9]{7,15}$'
 or pg_catalog.length(v_phone)>40
 or pg_catalog.length(coalesce(v_business_name,''))>160
 or pg_catalog.length(coalesce(v_address,''))>500
 or v_name ~ '[[:cntrl:]]'
 or coalesce(v_business_name,'') ~ '[[:cntrl:]]'
 or coalesce(v_address,'') ~ '[[:cntrl:]]' then
  raise exception 'Check customer details' using errcode='22023';
 end if;

 -- Lock by original owner, not submitted ID; repeated concurrent requests
 -- cannot produce two customer records or reveal another depot's ID.
 perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended('create-legacy-customer:'||v_actor::text,0)
 );
 select * into v_existing from private.legacy_customer_creation_requests
  where owner_id=v_actor and request_id=p_request_id for update;
 if found then
  if v_existing.customer_name is distinct from v_name
  or v_existing.customer_phone is distinct from v_phone
  or v_existing.customer_business_name is distinct from v_business_name
  or v_existing.customer_address is distinct from v_address then
   raise exception 'Customer request was already used with different details'
    using errcode='22023';
  end if;
  return pg_catalog.jsonb_build_object(
   'customerId',v_existing.customer_id,
   'requestId',p_request_id,'savedReplay',true
  );
 end if;

 -- SECURITY DEFINER executes the INSERT with elevated column privileges,
 -- but the existing legacy scope trigger validates auth.uid() and applies
 -- the current original business_id after audited activation.
 insert into public.customers(id,name,phone,business_name,address)
 values (
  pg_catalog.gen_random_uuid(),v_name,v_phone,v_business_name,v_address
 ) returning id into v_customer_id;

 insert into private.legacy_customer_creation_requests(
  owner_id,request_id,customer_id,customer_name,customer_phone,
  customer_business_name,customer_address
 ) values(v_actor,p_request_id,v_customer_id,v_name,v_phone,
  v_business_name,v_address);

 return pg_catalog.jsonb_build_object(
  'customerId',v_customer_id,
  'requestId',p_request_id,'savedReplay',false
 );
end;
$legacy_create$;

-- Only the original shop owner can pass the function's verified owner
-- guard, while the old global client-selected PK INSERT right disappears.
revoke insert(id) on public.customers from authenticated;
revoke all on function public.create_legacy_customer(uuid,text,text,text,text)
 from public,anon,authenticated,service_role;
grant execute on function public.create_legacy_customer(uuid,text,text,text,text)
 to authenticated;

do $verify_legacy_create_grants$
begin
 if has_column_privilege('authenticated','public.customers','id','INSERT')
    or has_column_privilege('authenticated','public.customers',
      'business_id','INSERT')
    or not has_column_privilege('authenticated','public.customers',
      'name','UPDATE')
    or not has_function_privilege('authenticated',
      'public.create_legacy_customer(uuid,text,text,text,text)','EXECUTE')
    or has_function_privilege('anon',
      'public.create_legacy_customer(uuid,text,text,text,text)','EXECUTE')
 then
  raise exception 'Unsafe legacy customer creation privileges';
 end if;
end;
$verify_legacy_create_grants$;
commit;
