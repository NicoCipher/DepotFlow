-- Explicit, audited final cutover from setup to active operations.
-- The owner review remains an attestation only; this separate RPC rechecks
-- the live ledger under lock before changing business status.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.business_activation_gate (
  singleton boolean primary key default true check (singleton is true),
  enabled boolean not null default false
);
insert into private.business_activation_gate(singleton,enabled)
values (true,false);

alter table private.business_activation_gate enable row level security;
revoke all on private.business_activation_gate
  from public,anon,authenticated,service_role;

create table private.business_opening_activations (
  business_id uuid primary key references private.businesses(id) on delete restrict,
  request_id uuid not null unique,
  actor_id uuid not null references auth.users(id) on delete restrict,
  review_request_id uuid not null,
  review_token text not null check (review_token ~ '^[0-9a-f]{32}$'),
  snapshot jsonb not null,
  activated_at timestamptz not null default pg_catalog.now()
);
alter table private.business_opening_activations enable row level security;
revoke all on private.business_opening_activations
  from public,anon,authenticated,service_role;

create function public.can_activate_business(p_business_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path=''
as $can_activate$
declare
  v_actor uuid:=auth.uid();
  v_status text;
  v_review private.business_opening_owner_reviews%rowtype;
  v_snapshot jsonb;
begin
  if v_actor is null or p_business_id is null then return false; end if;

  select b.status into v_status
  from private.business_memberships m
  join private.businesses b on b.id=m.business_id
  where m.business_id=p_business_id and m.user_id=v_actor
    and m.member_kind='owner' and m.status='active'
    and b.legacy_singleton is null and b.status='setup'
  for share of m,b;
  if not found then return false; end if;

  if not exists(select 1 from private.legacy_write_scope_gate where enabled is true)
     or not exists(select 1 from private.business_opening_readiness_gate where enabled is true)
     or not exists(select 1 from private.business_opening_review_gate where enabled is true)
     or not exists(select 1 from private.business_activation_gate where enabled is true) then
    return false;
  end if;

  select * into v_review
  from private.business_opening_owner_reviews
  where business_id=p_business_id and actor_id=v_actor;
  if not found then return false; end if;

  v_snapshot:=public.preview_business_opening_readiness(p_business_id);
  return v_review.review_token=pg_catalog.md5(v_snapshot::text)
    and v_review.snapshot=v_snapshot
    and v_snapshot->>'technicalChecklistComplete'='true'
    and v_snapshot->>'canActivate'='false'
    and v_snapshot->>'operationalEventsBeforeCutover'='0'
    and v_snapshot->'customerOpening'->>'accountMismatches'='0';
exception when others then
  return false;
end;
$can_activate$;
revoke all on function public.can_activate_business(uuid) from public,anon;
grant execute on function public.can_activate_business(uuid) to authenticated;

create function public.business_opening_review_status(p_business_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $review_status$
declare
  v_actor uuid:=auth.uid();
  v_status text;
  v_review private.business_opening_owner_reviews%rowtype;
  v_activation private.business_opening_activations%rowtype;
  v_can_activate boolean:=false;
begin
  if v_actor is null or p_business_id is null then
    raise exception 'Verified business owner required' using errcode='42501';
  end if;
  select b.status into v_status
  from private.business_memberships m
  join private.businesses b on b.id=m.business_id
  where m.business_id=p_business_id and m.user_id=v_actor
    and m.member_kind='owner' and m.status='active'
    and b.legacy_singleton is null and b.status in ('setup','active')
  for share of m,b;
  if not found then
    raise exception 'Business setup is not available' using errcode='42501';
  end if;

  select * into v_activation
  from private.business_opening_activations
  where business_id=p_business_id;
  if v_status='active' then
    if not found then
      raise exception 'Active business has no matching activation audit'
        using errcode='42501';
    end if;
    return pg_catalog.jsonb_build_object(
      'businessId',p_business_id,'businessStatus','active',
      'reviewRecorded',true,'activated',true,
      'activatedAt',v_activation.activated_at,
      'canActivate',false
    );
  end if;

  select * into v_review
  from private.business_opening_owner_reviews
  where business_id=p_business_id;
  if not found then
    return pg_catalog.jsonb_build_object(
      'businessId',p_business_id,'businessStatus','setup',
      'reviewRecorded',false,'activated',false,'canActivate',false
    );
  end if;

  if v_review.actor_id is distinct from v_actor then
    return pg_catalog.jsonb_build_object(
      'businessId',p_business_id,'businessStatus','setup',
      'reviewRecorded',true,'activated',false,
      'reviewedByCurrentOwner',false,
      'reviewedAt',v_review.signed_at,
      'canActivate',false
    );
  end if;

  v_can_activate:=public.can_activate_business(p_business_id);
  return pg_catalog.jsonb_build_object(
    'businessId',p_business_id,'businessStatus','setup',
    'reviewRecorded',true,'activated',false,
    'reviewedByCurrentOwner',true,
    'reviewRequestId',v_review.request_id,
    'reviewToken',v_review.review_token,
    'reviewedAt',v_review.signed_at,
    'canActivate',v_can_activate
  );
end;
$review_status$;
revoke all on function public.business_opening_review_status(uuid) from public,anon;
grant execute on function public.business_opening_review_status(uuid) to authenticated;

create function public.activate_business_after_opening_review(
  p_business_id uuid,
  p_request_id uuid,
  p_review_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $activate$
declare
  v_actor uuid:=auth.uid();
  v_status text;
  v_review private.business_opening_owner_reviews%rowtype;
  v_existing private.business_opening_activations%rowtype;
  v_snapshot jsonb;
begin
  if v_actor is null or p_business_id is null then
    raise exception 'Verified business owner required' using errcode='42501';
  end if;
  if p_request_id is null or p_review_token is null
     or p_review_token !~ '^[0-9a-f]{32}$' then
    raise exception 'Activation request is invalid' using errcode='22023';
  end if;

  -- Exclusive locks serialize activation against setup edits, opening writes,
  -- owner revocation and operational writers.
  select b.status into v_status
  from private.business_memberships m
  join private.businesses b on b.id=m.business_id
  where m.business_id=p_business_id and m.user_id=v_actor
    and m.member_kind='owner' and m.status='active'
    and b.legacy_singleton is null and b.status in ('setup','active')
  for update of m,b;
  if not found then
    raise exception 'Business activation is not available to this owner'
      using errcode='42501';
  end if;

  select * into v_existing
  from private.business_opening_activations
  where business_id=p_business_id
  for update;
  if v_status='active' then
    if found and v_existing.request_id=p_request_id
       and v_existing.actor_id=v_actor
       and v_existing.review_token=p_review_token then
      return pg_catalog.jsonb_build_object(
        'businessId',p_business_id,'status','active',
        'activatedAt',v_existing.activated_at,'activated',true,
        'savedReplay',true
      );
    end if;
    raise exception 'This depot is already active; the activation request does not match its audit'
      using errcode='22023';
  end if;
  if v_status<>'setup' then
    raise exception 'Only a setup depot can be activated' using errcode='42501';
  end if;

  perform 1 from private.legacy_write_scope_gate where enabled is true for share;
  if not found
     or not exists(select 1 from private.business_opening_readiness_gate where enabled is true)
     or not exists(select 1 from private.business_opening_review_gate where enabled is true)
     or not exists(select 1 from private.business_activation_gate where enabled is true) then
    raise exception 'Final depot activation is not enabled' using errcode='42501';
  end if;

  select * into v_review
  from private.business_opening_owner_reviews
  where business_id=p_business_id
  for update;
  if not found or v_review.actor_id is distinct from v_actor
     or v_review.review_token is distinct from p_review_token then
    raise exception 'The owner opening review is missing or does not match'
      using errcode='42501';
  end if;

  -- Recompute the complete opening snapshot while holding the business lock.
  -- A review token is a stale-data detector, not permission to skip this read.
  v_snapshot:=public.preview_business_opening_readiness(p_business_id);
  if pg_catalog.md5(v_snapshot::text) is distinct from v_review.review_token
     or v_snapshot is distinct from v_review.snapshot
     or v_snapshot->>'technicalChecklistComplete' is distinct from 'true'
     or v_snapshot->>'canActivate' is distinct from 'false'
     or v_snapshot->>'operationalEventsBeforeCutover' is distinct from '0'
     or v_snapshot->'customerOpening'->>'accountMismatches' is distinct from '0' then
    raise exception 'Opening records changed or are incomplete. Review the depot again.'
      using errcode='22023';
  end if;

  insert into private.business_opening_activations(
    business_id,request_id,actor_id,review_request_id,review_token,snapshot
  ) values (
    p_business_id,p_request_id,v_actor,v_review.request_id,
    v_review.review_token,v_snapshot
  );

  update private.businesses
  set status='active'
  where id=p_business_id and status='setup';
  if not found then
    raise exception 'Depot status changed before activation' using errcode='40001';
  end if;

  return pg_catalog.jsonb_build_object(
    'businessId',p_business_id,'status','active',
    'activatedAt',(select a.activated_at from private.business_opening_activations a where a.business_id=p_business_id),
    'activated',true,'savedReplay',false
  );
end;
$activate$;
revoke all on function public.activate_business_after_opening_review(uuid,uuid,text)
  from public,anon;
grant execute on function public.activate_business_after_opening_review(uuid,uuid,text)
  to authenticated;

commit;
