-- M2 controlled onboarding: one-time operator-authorised Auth invitation.
-- Public signup stays closed. Only an actual GoTrue invite (invited_at set)
-- matching one unexpired operator-prepared email can pass the auth.users guard.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.business_invitation_requests (
  request_id uuid primary key,
  email text not null,
  business_name text not null,
  business_address text not null,
  business_phone text not null,
  status text not null default 'prepared'
    check (status in ('prepared','user_created','provisioned','expired','cancelled')),
  created_at timestamptz not null default pg_catalog.now(),
  expires_at timestamptz not null,
  prepared_by text not null default session_user,
  consumed_at timestamptz,
  invited_user_id uuid,
  business_id uuid references private.businesses(id) on delete restrict,
  provisioned_at timestamptz,
  constraint business_invitation_email_normalized
    check (email=pg_catalog.lower(pg_catalog.btrim(email))),
  constraint business_invitation_name_length
    check (pg_catalog.length(business_name) between 2 and 120),
  constraint business_invitation_address_length
    check (pg_catalog.length(business_address) between 1 and 400),
  constraint business_invitation_phone_length
    check (pg_catalog.length(business_phone)<=40),
  constraint business_invitation_provisioned_shape
    check (status<>'provisioned' or
      (invited_user_id is not null and business_id is not null and provisioned_at is not null))
);
create unique index business_invitation_one_pending_email
  on private.business_invitation_requests(email)
  where status='prepared';
create unique index business_invitation_one_request_per_user
  on private.business_invitation_requests(invited_user_id)
  where invited_user_id is not null;

alter table private.business_invitation_requests enable row level security;
revoke all on private.business_invitation_requests
  from public,anon,authenticated,service_role;

-- This is a deliberate operator-only preparation step. Supabase SQL Editor
-- runs as postgres; no app/API role can prepare invitations or choose owners.
create function private.prepare_business_invitation(
  p_request_id uuid,
  p_email text,
  p_business_name text,
  p_business_address text,
  p_business_phone text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $prepare$
declare
  v_email text;
  v_name text;
  v_address text;
  v_phone text;
  v_saved private.business_invitation_requests%rowtype;
  v_expiry timestamptz;
begin
  if session_user<>'postgres' then
    raise exception 'Operator database session required'
      using errcode='42501';
  end if;
  v_email:=pg_catalog.lower(pg_catalog.btrim(coalesce(p_email,'')));
  v_name:=pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_business_name,''),'[[:space:]]+',' ','g'));
  v_address:=pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_business_address,''),'[[:space:]]+',' ','g'));
  v_phone:=pg_catalog.btrim(coalesce(p_business_phone,''));

  if p_request_id is null
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     or pg_catalog.length(v_name) not between 2 and 120
     or pg_catalog.length(v_address) not between 1 and 400
     or pg_catalog.length(v_phone)>40
     or v_name ~ '[[:cntrl:]]'
     or v_address ~ '[[:cntrl:]]'
     or v_phone ~ '[[:cntrl:]]' then
    raise exception 'Check the invitation email and depot details'
      using errcode='22023';
  end if;

  -- Expired, unused authorisations cannot block a later operator request.
  update private.business_invitation_requests
    set status='expired'
    where email=v_email and status='prepared'
      and expires_at<=pg_catalog.now();

  select * into v_saved
  from private.business_invitation_requests
  where request_id=p_request_id
  for update;
  if found then
    if v_saved.email is distinct from v_email
       or v_saved.business_name is distinct from v_name
       or v_saved.business_address is distinct from v_address
       or v_saved.business_phone is distinct from v_phone then
      raise exception 'Invitation request ID was already used with different details'
        using errcode='22023';
    end if;
    if v_saved.status not in ('prepared','user_created','provisioned')
       or (v_saved.status='prepared' and v_saved.expires_at<=pg_catalog.now()) then
      raise exception 'This invitation request has expired or was cancelled'
        using errcode='22023';
    end if;
    return pg_catalog.jsonb_build_object(
      'requestId',v_saved.request_id,
      'email',v_saved.email,
      'businessName',v_saved.business_name,
      'status',v_saved.status,
      'expiresAt',v_saved.expires_at,
      'savedReplay',true
    );
  end if;

  if exists(
    select 1 from auth.users u
    where pg_catalog.lower(pg_catalog.btrim(u.email))=v_email
  ) then
    raise exception 'An Auth account already exists for this email; do not create another invitation'
      using errcode='23505';
  end if;

  if exists(
    select 1 from private.business_invitation_requests
    where email=v_email and status='prepared'
      and expires_at>pg_catalog.now()
  ) then
    raise exception 'A live invitation is already prepared for this email'
      using errcode='23505';
  end if;

  v_expiry:=pg_catalog.now()+interval '15 minutes';
  insert into private.business_invitation_requests(
    request_id,email,business_name,business_address,business_phone,expires_at
  ) values (
    p_request_id,v_email,v_name,v_address,v_phone,v_expiry
  );

  return pg_catalog.jsonb_build_object(
    'requestId',p_request_id,
    'email',v_email,
    'businessName',v_name,
    'status','prepared',
    'expiresAt',v_expiry,
    'savedReplay',false
  );
end;
$prepare$;
revoke all on function private.prepare_business_invitation(uuid,text,text,text,text)
  from public,anon,authenticated,service_role;

-- Auth's Before User Created hook runs before auth.users INSERT. It may
-- approve the exact prepared email, but the trigger below is authoritative:
-- it also requires GoTrue's invited_at marker and consumes the request in
-- the auth.users INSERT transaction.
create or replace function private.depotflow_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $auth_signup$
declare
  v_email text;
  v_signup_enabled boolean;
  v_invited boolean;
begin
  v_email:=pg_catalog.lower(pg_catalog.btrim(coalesce(event->'user'->>'email','')));
  if pg_catalog.jsonb_typeof(event) is distinct from 'object'
     or pg_catalog.jsonb_typeof(event->'user') is distinct from 'object'
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    return pg_catalog.jsonb_build_object(
      'error',pg_catalog.jsonb_build_object(
        'http_code',403,
        'message','Account registration is not available.'
      )
    );
  end if;

  select g.enabled into v_signup_enabled
  from private.business_auth_signup_gate g
  where g.singleton is true;

  select exists(
    select 1 from private.business_invitation_requests i
    where i.email=v_email and i.status='prepared'
      and i.expires_at>pg_catalog.now()
  ) into v_invited;

  if v_signup_enabled is distinct from true and not v_invited then
    return pg_catalog.jsonb_build_object(
      'error',pg_catalog.jsonb_build_object(
        'http_code',403,
        'message','Account registration is not available.'
      )
    );
  end if;
  return '{}'::jsonb;
end;
$auth_signup$;
revoke all on function private.depotflow_before_user_created(jsonb)
  from public,anon,authenticated,service_role;
grant execute on function private.depotflow_before_user_created(jsonb)
  to supabase_auth_admin;

-- Keep the atomic INSERT fence. With the global signup gate OFF, only
-- supabase_auth_admin creating a user for the exact prepared, unexpired email
-- can consume the one-time authorisation. GoTrue may populate invited_at after
-- the initial INSERT, so the trigger must not depend on that later marker.
create or replace function private.depotflow_auth_user_insert_guard()
returns trigger
language plpgsql
volatile
security definer
set search_path=''
as $before_auth_insert$
declare
  v_enabled boolean;
  v_request_id uuid;
begin
  if session_user='postgres' then
    return new;
  end if;

  select g.enabled into v_enabled
  from private.business_auth_signup_gate g
  where g.singleton is true
  for share;
  if v_enabled is true then
    return new;
  end if;

  if session_user='supabase_auth_admin'
     and coalesce(new.email,'')<>'' then
    select i.request_id into v_request_id
    from private.business_invitation_requests i
    where i.email=pg_catalog.lower(pg_catalog.btrim(new.email))
      and i.status='prepared'
      and i.expires_at>pg_catalog.now()
    order by i.created_at desc
    limit 1
    for update;
    if found then
      update private.business_invitation_requests
      set status='user_created',
          invited_user_id=new.id,
          consumed_at=pg_catalog.now()
      where request_id=v_request_id and status='prepared';
      if found then
        return new;
      end if;
    end if;
  end if;

  raise exception 'Account registration is not available.'
    using errcode='42501';
end;
$before_auth_insert$;
revoke all on function private.depotflow_auth_user_insert_guard()
  from public,anon,authenticated,service_role;

-- Provisioning is a second explicit operator step after the Auth invite
-- transaction succeeds. It atomically creates business, owner membership,
-- profile and the existing registration audit row. Public signup stays OFF.
create function private.provision_invited_business(p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $provision$
declare
  v_invite private.business_invitation_requests%rowtype;
  v_user_email text;
  v_business_id uuid;
  v_owner_count integer;
begin
  if session_user<>'postgres' then
    raise exception 'Operator database session required'
      using errcode='42501';
  end if;
  if p_request_id is null then
    raise exception 'Invitation request is required'
      using errcode='22023';
  end if;

  select * into v_invite
  from private.business_invitation_requests
  where request_id=p_request_id
  for update;
  if not found then
    raise exception 'Invitation request was not found'
      using errcode='22023';
  end if;

  if v_invite.status='provisioned' then
    if not exists(
      select 1 from private.business_memberships m
      join private.businesses b on b.id=m.business_id
      where m.business_id=v_invite.business_id
        and m.user_id=v_invite.invited_user_id
        and m.member_kind='owner' and m.status='active'
        and b.status='setup' and b.legacy_singleton is null
    ) then
      raise exception 'Provisioned business ownership no longer matches the audit record'
        using errcode='42501';
    end if;
    return pg_catalog.jsonb_build_object(
      'requestId',v_invite.request_id,
      'businessId',v_invite.business_id,
      'ownerId',v_invite.invited_user_id,
      'businessName',v_invite.business_name,
      'status','setup',
      'savedReplay',true,
      'canOperate',false
    );
  end if;

  if v_invite.status<>'user_created'
     or v_invite.invited_user_id is null
     or v_invite.consumed_at is null then
    raise exception 'A successful one-time Auth invitation is required before provisioning'
      using errcode='42501';
  end if;

  select u.email into v_user_email
  from auth.users u
  where u.id=v_invite.invited_user_id;
  if not found or pg_catalog.lower(pg_catalog.btrim(v_user_email))
       is distinct from v_invite.email then
    raise exception 'Invited Auth user does not match the authorised email'
      using errcode='42501';
  end if;

  select count(*) into v_owner_count
  from private.business_memberships m
  join private.businesses b on b.id=m.business_id
  where m.user_id=v_invite.invited_user_id
    and m.member_kind='owner' and b.legacy_singleton is null;
  if v_owner_count>=3 then
    raise exception 'This owner has reached the depot limit'
      using errcode='22023';
  end if;

  insert into private.businesses(status)
  values('setup')
  returning id into v_business_id;

  insert into private.business_memberships(
    business_id,user_id,member_kind,status
  ) values (
    v_business_id,v_invite.invited_user_id,'owner','active'
  );

  insert into public.business_profiles(
    business_id,name,address,phone
  ) values (
    v_business_id,v_invite.business_name,
    v_invite.business_address,v_invite.business_phone
  );

  insert into private.business_registration_requests(
    owner_id,request_id,business_id,business_name,business_address,business_phone
  ) values (
    v_invite.invited_user_id,v_invite.request_id,v_business_id,
    v_invite.business_name,v_invite.business_address,v_invite.business_phone
  );

  update private.business_invitation_requests
  set status='provisioned',
      business_id=v_business_id,
      provisioned_at=pg_catalog.now()
  where request_id=p_request_id;

  return pg_catalog.jsonb_build_object(
    'requestId',p_request_id,
    'businessId',v_business_id,
    'ownerId',v_invite.invited_user_id,
    'businessName',v_invite.business_name,
    'status','setup',
    'savedReplay',false,
    'canOperate',false
  );
end;
$provision$;
revoke all on function private.provision_invited_business(uuid)
  from public,anon,authenticated,service_role;

commit;
