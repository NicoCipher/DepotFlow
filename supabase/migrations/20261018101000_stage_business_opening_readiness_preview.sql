-- M2f-31: read-only readiness inspection for future "Review & Start".
-- This is NOT an activation RPC. The production gate is OFF, and neither
-- anon nor authenticated can EXECUTE this function until a reviewed release.
-- The final activation transaction must revalidate all checks atomically.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.business_opening_readiness_gate (
 singleton boolean primary key default true check(singleton is true),
 enabled boolean not null default false
);
insert into private.business_opening_readiness_gate(singleton,enabled)
 values(true,false);
alter table private.business_opening_readiness_gate enable row level security;
revoke all on private.business_opening_readiness_gate
 from public,anon,authenticated,service_role;

create function public.preview_business_opening_readiness(
 p_business_id uuid
) returns jsonb
language plpgsql volatile security definer set search_path=''
as $readiness$
declare
 v_actor uuid:=auth.uid();
 v_status text;
 v_profile jsonb;
 v_drinks int;
 v_crates int;
 v_bottle_types int;
 v_customers int;
 v_customer_openings int;
 v_open_money bigint;
 v_open_deposits bigint;
 v_open_crates bigint;
 v_open_bottles bigint;
 v_missing_drinks int;
 v_missing_crates int;
 v_missing_bottles int;
 v_unknown_returnables int;
 v_balance_mismatch int;
 v_operational_events int;
 v_physical_drift int;
 v_missing_drink_ids jsonb;
 v_missing_crate_ids jsonb;
 v_missing_bottle_labels jsonb;
 v_reviewable boolean;
begin
 if v_actor is null or p_business_id is null then
  raise exception 'Verified business owner session required'
   using errcode='42501';
 end if;
 -- Ownership is checked BEFORE any business-specific data query.
 select b.status into v_status
 from private.business_memberships m
 join private.businesses b on b.id=m.business_id
 where m.business_id=p_business_id and m.user_id=v_actor
  and m.member_kind='owner' and m.status='active'
  and b.legacy_singleton is null and b.status='setup'
 for share of m,b;
 if not found then
  raise exception 'Business setup is not available' using errcode='42501';
 end if;
 perform 1 from private.business_opening_readiness_gate
  where enabled is true for share;
 if not found or not exists(
  select 1 from private.legacy_write_scope_gate where enabled is true
 ) then
  raise exception 'Business opening review is not available'
   using errcode='42501';
 end if;

 select pg_catalog.jsonb_build_object(
  'name',p.name,'address',p.address,'phone',p.phone)
 into v_profile from public.business_profiles p
 where p.business_id=p_business_id;

 select count(*) into v_drinks from public.products
  where business_id=p_business_id and is_active is true;
 select count(*) into v_crates from public.crate_types
  where business_id=p_business_id and is_legacy is false;
 select count(*) into v_customers from public.customers
  where business_id=p_business_id and archived_at is null;
 select count(*) into v_customer_openings from public.customer_opening_balances
  where business_id=p_business_id;
 select coalesce(sum(amount),0) into v_open_money
  from public.customer_opening_balances where business_id=p_business_id;
 select coalesce(sum(deposit_amount),0) into v_open_deposits
  from public.customer_opening_balances where business_id=p_business_id;
 select coalesce(sum((v.value->>'quantity')::bigint),0)
 into v_open_crates from public.customer_opening_balances e
 cross join lateral pg_catalog.jsonb_array_elements(e.crates) v
 where e.business_id=p_business_id;
 select coalesce(sum((v.value->>'quantity')::bigint),0)
 into v_open_bottles from public.customer_opening_balances e
 cross join lateral pg_catalog.jsonb_array_elements(e.bottles) v
 where e.business_id=p_business_id;

 -- A zero opening count MUST have its own immutable line. An unrelated
 -- ordinary zero-stock event or a missing physical row is NOT sufficient.
 select count(*) into v_missing_drinks from public.products p
 where p.business_id=p_business_id and p.is_active is true
 and (
   not exists (
     select 1 from private.business_physical_opening_lines o
     where o.business_id=p_business_id and o.kind='drink'
       and o.resource_key=p.id::text)
   or not exists (
     select 1 from public.stock s
     where s.business_id=p_business_id and s.product_id=p.id)
 );
 select coalesce(pg_catalog.jsonb_agg(q.id), '[]'::jsonb)
 into v_missing_drink_ids from (
  select p.id from public.products p
  where p.business_id=p_business_id and p.is_active is true
    and (not exists(
      select 1 from private.business_physical_opening_lines o
      where o.business_id=p_business_id and o.kind='drink'
        and o.resource_key=p.id::text)
      or not exists(
        select 1 from public.stock s
        where s.business_id=p_business_id and s.product_id=p.id))
  order by p.id limit 20
 ) q;

 select count(*) into v_missing_crates from public.crate_types c
 where c.business_id=p_business_id and c.is_legacy is false
 and (
  not exists (
    select 1 from private.business_physical_opening_lines o
    where o.business_id=p_business_id and o.kind='crate'
      and o.resource_key=c.id::text)
  or not exists(
    select 1 from public.empty_crate_stock s
    where s.business_id=p_business_id and s.crate_type_id=c.id)
 );
 select coalesce(pg_catalog.jsonb_agg(q.id),'[]'::jsonb)
 into v_missing_crate_ids from (
  select c.id from public.crate_types c
  where c.business_id=p_business_id and c.is_legacy is false
    and (not exists(
      select 1 from private.business_physical_opening_lines o
      where o.business_id=p_business_id and o.kind='crate'
        and o.resource_key=c.id::text)
      or not exists(
        select 1 from public.empty_crate_stock s
        where s.business_id=p_business_id and s.crate_type_id=c.id))
  order by c.id limit 20
 ) q;

 select count(distinct p.bottle_type) into v_bottle_types
 from public.products p
 where p.business_id=p_business_id and p.is_active is true
  and p.bottles_returnable is true and p.bottle_type is not null
  and pg_catalog.btrim(p.bottle_type)<>'';
 select count(*) into v_unknown_returnables from public.products p
 where p.business_id=p_business_id and p.is_active is true
  and p.bottles_returnable is true
  and (p.bottle_type is null or pg_catalog.btrim(p.bottle_type)='');

 with types as (
  select distinct p.bottle_type as label from public.products p
  where p.business_id=p_business_id and p.is_active is true
    and p.bottles_returnable is true and p.bottle_type is not null
    and pg_catalog.btrim(p.bottle_type)<>''
 ), missing as (
  select t.label from types t
  where not exists(
    select 1 from private.business_physical_opening_lines o
    where o.business_id=p_business_id and o.kind='bottle'
      and o.resource_key=t.label
  ) or not exists(
    select 1 from public.empty_bottle_stock s
    where s.business_id=p_business_id and s.bottle_type=t.label
  )
 )
 select count(*) into v_missing_bottles from missing;
 with types as (
  select distinct p.bottle_type as label from public.products p
  where p.business_id=p_business_id and p.is_active is true
    and p.bottles_returnable is true and p.bottle_type is not null
    and pg_catalog.btrim(p.bottle_type)<>''
 ), missing as (
  select t.label from types t
  where not exists(
    select 1 from private.business_physical_opening_lines o
    where o.business_id=p_business_id and o.kind='bottle'
      and o.resource_key=t.label
  ) or not exists(
    select 1 from public.empty_bottle_stock s
    where s.business_id=p_business_id and s.bottle_type=t.label
  )
 )
 select coalesce(pg_catalog.jsonb_agg(q.label),'[]'::jsonb)
 into v_missing_bottle_labels from (
  select label from missing order by label limit 20
 ) q;

 -- These current balances must have been introduced by an opening event.
 -- The preview reports mismatches rather than silently treating them as
 -- pre-system balances. The final cutover must independently verify all
 -- per-crate/per-bottle quantities before activation.
 -- Compare the ACTUAL customer ledger to each immutable opening:
 -- absence means zero, but a missing nonzero ledger row is still a mismatch.
 -- Check precise branded crate/bottle identities, not just grand totals.
 select count(*) into v_balance_mismatch from public.customers c
 where c.business_id=p_business_id and (
   coalesce((select m.amount from public.money_owed m
     where m.customer_id=c.id and m.business_id=p_business_id),0)
   <>coalesce((select o.amount from public.customer_opening_balances o
     where o.customer_id=c.id and o.business_id=p_business_id),0)
  or
   coalesce((select d.amount from public.deposits d
     where d.customer_id=c.id and d.business_id=p_business_id),0)
   <>coalesce((select o.deposit_amount from public.customer_opening_balances o
     where o.customer_id=c.id and o.business_id=p_business_id),0)
  or exists(
   select 1 from public.crate_obligations co
   where co.customer_id=c.id and co.business_id=p_business_id
     and co.quantity<>coalesce((
      select (x.value->>'quantity')::int
      from public.customer_opening_balances o
      cross join lateral pg_catalog.jsonb_array_elements(o.crates) x
      where o.customer_id=c.id and o.business_id=p_business_id
        and (x.value->>'type')::uuid=co.crate_type_id
     ),0)
  )
  or exists(
   select 1 from public.customer_opening_balances o
   cross join lateral pg_catalog.jsonb_array_elements(o.crates) x
   where o.customer_id=c.id and o.business_id=p_business_id
     and (x.value->>'quantity')::int<>coalesce((
      select co.quantity from public.crate_obligations co
      where co.customer_id=c.id and co.business_id=p_business_id
        and co.crate_type_id=(x.value->>'type')::uuid
     ),0)
  )
  or exists(
   select 1 from public.bottle_obligations bo
   where bo.customer_id=c.id and bo.business_id=p_business_id
     and bo.quantity<>coalesce((
      select (x.value->>'quantity')::int
      from public.customer_opening_balances o
      cross join lateral pg_catalog.jsonb_array_elements(o.bottles) x
      where o.customer_id=c.id and o.business_id=p_business_id
        and x.value->>'type'=bo.bottle_type
     ),0)
  )
  or exists(
   select 1 from public.customer_opening_balances o
   cross join lateral pg_catalog.jsonb_array_elements(o.bottles) x
   where o.customer_id=c.id and o.business_id=p_business_id
     and (x.value->>'quantity')::int<>coalesce((
      select bo.quantity from public.bottle_obligations bo
      where bo.customer_id=c.id and bo.business_id=p_business_id
        and bo.bottle_type=x.value->>'type'
     ),0)
  )
 );

 -- A tagged opening whose stock was later physically recounted is not
 -- a faithful cutover snapshot. Block it instead of displaying "ready".
 select count(*) into v_physical_drift
 from private.business_physical_opening_lines o
 where o.business_id=p_business_id
 and (
   (o.kind='drink' and coalesce((
      select s.total_bottles from public.stock s
      where s.business_id=p_business_id
        and s.product_id=o.resource_key::uuid
    ),-1)<>coalesce((o.result->>'total')::int,-1))
   or
   (o.kind='crate' and coalesce((
      select s.quantity from public.empty_crate_stock s
      where s.business_id=p_business_id
        and s.crate_type_id=o.resource_key::uuid
    ),-1)<>coalesce((o.result->>'quantity')::int,-1))
   or
   (o.kind='bottle' and coalesce((
      select s.quantity from public.empty_bottle_stock s
      where s.business_id=p_business_id
        and s.bottle_type=o.resource_key
    ),-1)<>coalesce((o.result->>'quantity')::int,-1))
 );
 select (
  (select count(*) from public.sales
    where business_id=p_business_id)
  +(select count(*) from public.customer_payments
    where business_id=p_business_id)
  +(select count(*) from private.business_receiving_requests
    where business_id=p_business_id)
 ) into v_operational_events;

 v_reviewable:=v_profile is not null and v_drinks>0
  and v_missing_drinks=0 and v_missing_crates=0
  and v_missing_bottles=0 and v_unknown_returnables=0
  and v_balance_mismatch=0 and v_physical_drift=0
  and v_operational_events=0;

 return pg_catalog.jsonb_build_object(
  'businessId',p_business_id,'businessStatus',v_status,
  'profile',v_profile,
  'configured',pg_catalog.jsonb_build_object(
    'activeDrinks',v_drinks,'crateTypes',v_crates,
    'returnableBottleTypes',v_bottle_types,'activeCustomers',v_customers),
  'physicalOpening',pg_catalog.jsonb_build_object(
    'missingDrinks',v_missing_drinks,
    'missingCrates',v_missing_crates,
    'missingBottleTypes',v_missing_bottles,
    'missingDrinkIds',v_missing_drink_ids,
    'missingCrateTypeIds',v_missing_crate_ids,
    'missingBottleTypeLabels',v_missing_bottle_labels,
    'unconfiguredReturnables',v_unknown_returnables,
    'changedAfterOpening',v_physical_drift,
    'shownLimitPerCategory',20),
  'customerOpening',pg_catalog.jsonb_build_object(
    'customersWithOpening',v_customer_openings,
    'customersWithoutOpening',greatest(v_customers-v_customer_openings,0),
    'historicalDebtNaira',v_open_money,
    'refundableDepositsHeldNaira',v_open_deposits,
    'customerCratesOwed',v_open_crates,
    'customerBottlesOwed',v_open_bottles,
    'accountMismatches',v_balance_mismatch),
  'operationalEventsBeforeCutover',v_operational_events,
  'technicalChecklistComplete',v_reviewable,
  'customerHistoryAttestationRequired',true,
  'canActivate',false,
  'reason','Read-only preview; release-gated independent cutover/activation is not implemented.'
 );
end;
$readiness$;
revoke all on function public.preview_business_opening_readiness(uuid)
 from public,anon,authenticated,service_role;
commit;
