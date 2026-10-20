-- M2f-43: do not accept browser-supplied customer primary keys.
-- Registered customer ID comes from PostgreSQL, with tenant-qualified,
-- immutable request replay. The RPC is STAGED and ungranted; the old
-- legacy customer write flow remains unchanged until a dedicated release.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.business_customer_registration_gate (
 singleton boolean primary key default true check(singleton is true),
 enabled boolean not null default false
);
insert into private.business_customer_registration_gate(singleton,enabled)
 values(true,false);
alter table private.business_customer_registration_gate enable row level security;
revoke all on private.business_customer_registration_gate
 from public,anon,authenticated,service_role;

create table private.business_customer_registration_requests (
 business_id uuid not null references private.businesses(id) on delete restrict,
 request_id uuid not null,
 owner_id uuid not null references auth.users(id) on delete restrict,
 customer_id uuid not null unique references public.customers(id) on delete restrict,
 customer_name text not null,
 customer_phone text not null,
 customer_business_name text,
 customer_address text,
 created_at timestamptz not null default pg_catalog.now(),
 primary key(business_id,request_id)
);
alter table private.business_customer_registration_requests enable row level security;
revoke all on private.business_customer_registration_requests
 from public,anon,authenticated,service_role;

create function public.register_business_customer(
 p_business_id uuid,
 p_request_id uuid,
 p_name text,
 p_phone text,
 p_customer_business_name text,
 p_address text
) returns jsonb
language plpgsql volatile security definer set search_path=''
as $register$
declare
 v_actor uuid:=auth.uid();
 v_customer_id uuid;
 v_name text;
 v_phone text;
 v_customer_business_name text;
 v_address text;
 v_saved private.business_customer_registration_requests%rowtype;
begin
 if v_actor is null or p_business_id is null then
  raise exception 'A verified depot owner session is required'
   using errcode='42501';
 end if;
 -- Hold membership/status locks on the exact SETUP business before any
 -- request lookup. Revoked owners must never use replay as a data oracle.
 perform 1 from private.business_memberships m
 join private.businesses b on b.id=m.business_id
 where m.business_id=p_business_id and m.user_id=v_actor
  and m.member_kind='owner' and m.status='active'
  and b.legacy_singleton is null and b.status='setup'
 for share of m,b;
 if not found then
  raise exception 'Customer setup is not available'
   using errcode='42501';
 end if;
 perform 1 from private.business_customer_registration_gate
  where enabled is true for share;
 if not found or not exists(
   select 1 from private.legacy_write_scope_gate where enabled is true
 ) or not exists(
   select 1 from private.business_selection_gate where enabled is true
 ) then
   raise exception 'Customer registration has not been enabled'
    using errcode='42501';
 end if;

 if p_request_id is null or p_name is null or p_phone is null then
  raise exception 'Valid customer details are required' using errcode='22023';
 end if;
 v_name:=pg_catalog.btrim(pg_catalog.regexp_replace(p_name,'[[:space:]]+',' ','g'));
 v_phone:=pg_catalog.btrim(p_phone);
 v_customer_business_name:=nullif(pg_catalog.btrim(
   pg_catalog.regexp_replace(coalesce(p_customer_business_name,''),'[[:space:]]+',' ','g')),'');
 v_address:=nullif(pg_catalog.btrim(coalesce(p_address,'')),'');
 if pg_catalog.length(v_name) not between 1 and 120
   or pg_catalog.length(v_phone)>40
   or v_phone !~ '^\+?[0-9]{7,15}$'
   or pg_catalog.length(coalesce(v_customer_business_name,''))>160
   or pg_catalog.length(coalesce(v_address,''))>500
   or v_name ~ '[[:cntrl:]]'
   or coalesce(v_customer_business_name,'') ~ '[[:cntrl:]]'
   or coalesce(v_address,'') ~ '[[:cntrl:]]' then
  raise exception 'Check customer name, phone and optional details'
   using errcode='22023';
 end if;

 -- The request ID is a client retry token, NEVER a database customer ID.
 -- Serializing per tenant handles simultaneous retries and prevents two
 -- requests racing the same immutable (business_id,request_id) audit.
 perform pg_catalog.pg_advisory_xact_lock(
   pg_catalog.hashtextextended(
     'register-business-customer:'||p_business_id::text,0)
 );
 select * into v_saved
 from private.business_customer_registration_requests
 where business_id=p_business_id and request_id=p_request_id for update;
 if found then
  if v_saved.owner_id is distinct from v_actor
   or v_saved.customer_name is distinct from v_name
   or v_saved.customer_phone is distinct from v_phone
   or v_saved.customer_business_name is distinct from v_customer_business_name
   or v_saved.customer_address is distinct from v_address then
    raise exception 'This customer request was already used with different details'
      using errcode='22023';
  end if;
  return pg_catalog.jsonb_build_object(
   'businessId',p_business_id,'requestId',p_request_id,
   'customerId',v_saved.customer_id,'savedReplay',true,'canOperate',false
  );
 end if;

 -- DB-generated identity prevents an authenticated owner from using a
 -- foreign business's known customer UUID as a global PK collision oracle.
 insert into public.customers(
  id,business_id,name,phone,business_name,address
 ) values (
  pg_catalog.gen_random_uuid(),p_business_id,v_name,v_phone,
  v_customer_business_name,v_address
 ) returning id into v_customer_id;

 insert into private.business_customer_registration_requests(
  business_id,request_id,owner_id,customer_id,customer_name,
  customer_phone,customer_business_name,customer_address
 ) values (
  p_business_id,p_request_id,v_actor,v_customer_id,v_name,v_phone,
  v_customer_business_name,v_address
 );
 return pg_catalog.jsonb_build_object(
  'businessId',p_business_id,'requestId',p_request_id,
  'customerId',v_customer_id,'savedReplay',false,'canOperate',false
 );
end;
$register$;
revoke all on function public.register_business_customer(
 uuid,uuid,text,text,text,text
) from public,anon,authenticated,service_role;
commit;
