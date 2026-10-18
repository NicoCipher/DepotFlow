-- M2f-33: owner acknowledgment of opening balances WITHOUT activation.
-- A sign-off is a versioned audit of what the owner saw, not permission
-- for staff, sales, inventory changes or starting live operations.
-- Default-OFF, both public RPCs have NO authenticated/anon EXECUTE.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.business_opening_review_gate (
 singleton boolean primary key default true check(singleton is true),
 enabled boolean not null default false
);
insert into private.business_opening_review_gate(singleton,enabled)
 values(true,false);
alter table private.business_opening_review_gate enable row level security;
revoke all on private.business_opening_review_gate
 from public,anon,authenticated,service_role;

create table private.business_opening_owner_reviews (
 business_id uuid primary key references private.businesses(id) on delete restrict,
 request_id uuid not null,
 actor_id uuid not null references auth.users(id) on delete restrict,
 reviewed_name text not null,
 review_token text not null,
 snapshot jsonb not null,
 signed_at timestamptz not null default pg_catalog.now(),
 check (
  pg_catalog.length(review_token)=32
  and snapshot->>'technicalChecklistComplete'='true'
  and snapshot->>'canActivate'='false'
 )
);
alter table private.business_opening_owner_reviews enable row level security;
revoke all on private.business_opening_owner_reviews
 from public,anon,authenticated,service_role;

-- Server-origin review token protects against an owner's STALE PREVIEW.
-- It is only a change detector, not authentication or an access token;
-- membership verification and immutable audit are enforced independently.
create function public.prepare_business_opening_review(
 p_business_id uuid
) returns jsonb
language plpgsql volatile security definer set search_path=''
as $prepare$
declare
 v_actor uuid:=auth.uid();
 v_snapshot jsonb;
begin
 if v_actor is null or p_business_id is null then
  raise exception 'Verified business owner required' using errcode='42501';
 end if;
 -- Both gates are mandatory before touching any financial details.
 perform 1 from private.business_memberships m
  join private.businesses b on b.id=m.business_id
  where m.business_id=p_business_id and m.user_id=v_actor
   and m.member_kind='owner' and m.status='active'
   and b.legacy_singleton is null and b.status='setup'
  for share of m,b;
 if not found then
  raise exception 'Business setup is unavailable' using errcode='42501';
 end if;
 perform 1 from private.business_opening_review_gate
  where enabled is true for share;
 if not found then
  raise exception 'Owner opening review is disabled' using errcode='42501';
 end if;
 v_snapshot:=public.preview_business_opening_readiness(p_business_id);
 return pg_catalog.jsonb_build_object(
  'snapshot',v_snapshot,
  'reviewToken',pg_catalog.md5(v_snapshot::text),
  'reviewOnly',true,'canActivate',false
 );
end;
$prepare$;
revoke all on function public.prepare_business_opening_review(uuid)
 from public,anon,authenticated,service_role;

create function public.confirm_business_opening_review(
 p_business_id uuid,p_request_id uuid,p_review_token text,
 p_confirmed_business_name text,p_stock_checked boolean,
 p_customer_debts_checked boolean,p_refundable_deposits_checked boolean,
 p_customer_empties_checked boolean,p_zero_history_checked boolean
) returns jsonb
language plpgsql volatile security definer set search_path=''
as $confirm$
declare
 v_actor uuid:=auth.uid();
 v_business_status text;
 v_saved private.business_opening_owner_reviews%rowtype;
 v_snapshot jsonb;
 v_current_token text;
 v_name text;
begin
 if v_actor is null or p_business_id is null then
  raise exception 'Verified business owner required' using errcode='42501';
 end if;
 -- Exclusive business lock serializes this snapshot with new-business
 -- writers that acquire shared membership/business locks. Even so, a
 -- post-signature change is possible: FINAL ACTIVATION must revalidate.
 select b.status into v_business_status
  from private.business_memberships m
  join private.businesses b on b.id=m.business_id
  where m.business_id=p_business_id and m.user_id=v_actor
   and m.member_kind='owner' and m.status='active'
   and b.legacy_singleton is null and b.status='setup'
  for update of m,b;
 if not found then
  raise exception 'Business setup is unavailable' using errcode='42501';
 end if;
 perform 1 from private.business_opening_review_gate
  where enabled is true for share;
 if not found or not exists(
  select 1 from private.business_opening_readiness_gate
  where enabled is true
 ) then
  raise exception 'Owner opening review is disabled' using errcode='42501';
 end if;
 if p_request_id is null or p_review_token is null
  or p_review_token !~ '^[0-9a-f]{32}$'
  or p_confirmed_business_name is null
  or pg_catalog.length(pg_catalog.btrim(p_confirmed_business_name)) not between 2 and 120
  or p_stock_checked is distinct from true
  or p_customer_debts_checked is distinct from true
  or p_refundable_deposits_checked is distinct from true
  or p_customer_empties_checked is distinct from true
  or p_zero_history_checked is distinct from true then
    raise exception 'Review each starting balance and confirm the depot name'
     using errcode='22023';
 end if;

 select * into v_saved
  from private.business_opening_owner_reviews
  where business_id=p_business_id for update;
 if found then
  if v_saved.request_id is distinct from p_request_id
   or v_saved.actor_id is distinct from v_actor
   or v_saved.review_token is distinct from p_review_token
   or v_saved.reviewed_name is distinct from pg_catalog.btrim(p_confirmed_business_name)
  then
   raise exception 'An opening review is already recorded for this depot'
    using errcode='22023';
  end if;
  return pg_catalog.jsonb_build_object(
   'businessId',p_business_id,'requestId',p_request_id,
   'reviewToken',v_saved.review_token,
   'signedAt',v_saved.signed_at,'recorded',true,
   'canActivate',false,'savedReplay',true
  );
 end if;

 -- Reread the actual financial and physical ledger WHILE holding the
 -- business lock, not merely trusting the preview the browser submitted.
 v_snapshot:=public.preview_business_opening_readiness(p_business_id);
 v_current_token:=pg_catalog.md5(v_snapshot::text);
 if v_current_token<>p_review_token then
  raise exception 'Opening figures changed. Review the updated balances.'
    using errcode='22023';
 end if;
 if v_snapshot->>'technicalChecklistComplete' is distinct from 'true'
    or v_snapshot->>'canActivate' is distinct from 'false'
 then
  raise exception 'Complete all physical and financial opening checks first'
   using errcode='22023';
 end if;
 v_name:=v_snapshot->'profile'->>'name';
 if v_name is null
    or v_name is distinct from pg_catalog.btrim(p_confirmed_business_name) then
  raise exception 'Confirm the exact business name shown on review'
   using errcode='22023';
 end if;

 insert into private.business_opening_owner_reviews(
  business_id,request_id,actor_id,reviewed_name,review_token,snapshot
 ) values(
  p_business_id,p_request_id,v_actor,v_name,v_current_token,v_snapshot
 );
 -- No UPDATE to private.businesses.status. No staff/checkout permissions.
 return pg_catalog.jsonb_build_object(
  'businessId',p_business_id,'requestId',p_request_id,
  'reviewToken',v_current_token,
  'recorded',true,'canActivate',false,'savedReplay',false
 );
end;
$confirm$;
revoke all on function public.confirm_business_opening_review(
 uuid,uuid,text,text,boolean,boolean,boolean,boolean,boolean
) from public,anon,authenticated,service_role;
commit;
