-- M2f-26: stage append-only, per-business buying-cost history.
-- The shared master catalogue has no prices. The existing shop keeps its
-- historical owner records; future depots receive independent costs.
-- DRAFT / NO-GO: default-OFF gate, no authenticated/anon EXECUTE permission.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- The old unique constraint is owner-scoped, so a single verified user owning
-- TWO businesses could not record the same cost for the same master drink.
-- Retain old owner uniqueness for nullable pre-backfill rows and use the
-- business ID once assigned. Fail CLOSED if history/index shape has drifted.
do $preflight_cost_legacy_key$
declare
  v_key text;
  v_name text;
begin
  select c.conname,pg_catalog.pg_get_constraintdef(c.oid)
    into v_name,v_key
  from pg_catalog.pg_constraint c
  where c.conrelid='public.product_cost_history'::regclass
    and c.contype='u'
    and pg_catalog.pg_get_constraintdef(c.oid)=
      'UNIQUE (owner_user_id, catalogue_product_id, effective_on, cost_price)';
  if v_name is null or v_key is distinct from
     'UNIQUE (owner_user_id, catalogue_product_id, effective_on, cost_price)' then
    raise exception 'Historical buying-cost uniqueness drift: %',v_key;
  end if;
  if exists (
    select 1 from public.product_cost_history
    where business_id is not null
    group by business_id,catalogue_product_id,effective_on,cost_price
    having count(*)>1
  ) then
    raise exception 'Duplicate business cost rows require manual reconciliation';
  end if;
end;
$preflight_cost_legacy_key$;

create unique index business_cost_history_unique
  on public.product_cost_history(
    business_id,catalogue_product_id,effective_on,cost_price
  ) where business_id is not null;
create unique index prebackfill_owner_cost_history_unique
  on public.product_cost_history(
    owner_user_id,catalogue_product_id,effective_on,cost_price
  ) where business_id is null;
-- PostgreSQL truncates auto-generated constraint names at 63 bytes.
-- Drop only the exact verified UNIQUE definition, not a guessed name.
do $drop_historical_cost_unique$
declare v_name name;
begin
  select c.conname into v_name
  from pg_catalog.pg_constraint c
  where c.conrelid='public.product_cost_history'::regclass
    and c.contype='u'
    and pg_catalog.pg_get_constraintdef(c.oid)=
      'UNIQUE (owner_user_id, catalogue_product_id, effective_on, cost_price)';
  if v_name is null then
    raise exception 'Verified historical cost unique constraint disappeared';
  end if;
  execute pg_catalog.format(
    'alter table public.product_cost_history drop constraint %I',v_name
  );
end;
$drop_historical_cost_unique$;

-- Cost visibility follows the owning depot. The original pilot still needs
-- its owner_user_id predicate, including during its NULL-tagged backfill.
alter policy owner_read on public.product_cost_history
  using (
    (owner_user_id=(select auth.uid())
     and private.can_read_legacy_customer(business_id))
    or (business_id is not null
        and private.can_manage_new_customer(business_id))
  );

create table private.business_cost_history_gate (
  singleton boolean primary key default true check (singleton is true),
  enabled boolean not null default false
);
insert into private.business_cost_history_gate(singleton,enabled)
 values(true,false);
alter table private.business_cost_history_gate enable row level security;
revoke all on private.business_cost_history_gate
  from public,anon,authenticated,service_role;

-- Only an internally authorized INSERT may pass the legacy operational
-- business stamping trigger. Direct owner table DML remains ungranted.
do $scope_new_cost_writes$
declare
  v_oid oid := 'private.scope_legacy_operational_write()'::regprocedure;
  v_src text;
  v_anchor constant text :=
    E'\n  v_actor := auth.uid();\n  -- Lock the authorization rows until the write transaction completes.';
  v_branch constant text := $guard$
  if tg_table_schema='public' and tg_table_name='product_cost_history'
     and tg_op='INSERT' and new.business_id is not null
     and new.business_id is distinct from v_business then
    if not exists (
      select 1 from private.business_cost_history_gate
      where enabled is true
    ) then
      raise exception 'Business buying-cost history is not available'
        using errcode='42501';
    end if;
    v_actor:=auth.uid();
    if v_actor is null or new.owner_user_id is distinct from v_actor then
      raise exception 'Verified buying-cost owner session required'
        using errcode='42501';
    end if;
    perform 1 from private.business_memberships m
      join private.businesses b on b.id=m.business_id
      where m.business_id=new.business_id and m.user_id=v_actor
        and m.member_kind='owner' and m.status='active'
        and b.status in ('setup','active') and b.legacy_singleton is null
      for share of m,b;
    if not found then
      raise exception 'Business not available' using errcode='42501';
    end if;
    return new;
  end if;

$guard$;
begin
  v_src:=pg_catalog.pg_get_functiondef(v_oid);
  if v_src is null
     or (pg_catalog.length(v_src)-pg_catalog.length(
        pg_catalog.replace(v_src,v_anchor,'')))/pg_catalog.length(v_anchor)<>1
     or pg_catalog.strpos(v_src,'private.business_assortment_setup_gate')=0
     or pg_catalog.strpos(v_src,'private.business_cost_history_gate')<>0 then
    raise exception 'Cost history write-trigger prerequisite drift';
  end if;
  execute pg_catalog.replace(v_src,v_anchor,v_branch||v_anchor);
end;
$scope_new_cost_writes$;

create function public.record_business_buying_cost(
  p_business_id uuid, p_event_id uuid, p_catalogue_product_id uuid,
  p_cost_price integer, p_effective_on date
) returns jsonb
language plpgsql security definer set search_path=''
as $record_cost$
declare
  v_actor uuid:=auth.uid();
  v_event public.product_cost_history%rowtype;
  v_written uuid;
begin
  -- Membership and gate checks MUST happen before immutable event lookup;
  -- a revoked owner must not replay or inspect a historical cost.
  if v_actor is null or p_business_id is null then
    raise exception 'Verified business owner session required'
      using errcode='42501';
  end if;
  perform 1 from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    where m.business_id=p_business_id and m.user_id=v_actor
      and m.member_kind='owner' and m.status='active'
      and b.status in ('setup','active') and b.legacy_singleton is null
    for share of m,b;
  if not found then
    raise exception 'Business not available' using errcode='42501';
  end if;
  perform 1 from private.business_cost_history_gate
    where enabled is true for share;
  if not found or not exists(
    select 1 from private.legacy_write_scope_gate where enabled is true
  ) then
    raise exception 'Business buying-cost history is not available'
      using errcode='42501';
  end if;
  if p_event_id is null or p_catalogue_product_id is null
     or p_cost_price is null or p_cost_price<0
     or p_effective_on is null then
    raise exception 'Choose a drink, buying cost and valid effective date'
      using errcode='22023';
  end if;

  -- Serialize uncertain saves by immutable event ID. This does not expose
  -- data from a different business which happens to supply the same UUID.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_business_id::text||':'||p_event_id::text,0)
  );
  select * into v_event from public.product_cost_history
    where id=p_event_id and business_id=p_business_id for update;
  if found then
    if v_event.catalogue_product_id is distinct from p_catalogue_product_id
       or v_event.cost_price is distinct from p_cost_price
       or v_event.effective_on is distinct from p_effective_on
       or v_event.owner_user_id is distinct from v_actor then
      raise exception 'This buying-cost request was already used'
        using errcode='22023';
    end if;
    return jsonb_build_object(
      'eventId',v_event.id,'businessId',p_business_id,
      'catalogueProductId',v_event.catalogue_product_id,
      'costPrice',v_event.cost_price,'effectiveOn',v_event.effective_on
    );
  end if;

  if not exists (
    select 1 from public.product_catalogue where id=p_catalogue_product_id
  ) then
    raise exception 'Master catalogue drink not found' using errcode='22023';
  end if;
  insert into public.product_cost_history(
    id,owner_user_id,business_id,catalogue_product_id,cost_price,effective_on
  ) values(
    p_event_id,v_actor,p_business_id,p_catalogue_product_id,
    p_cost_price,p_effective_on
  ) on conflict do nothing returning id into v_written;
  if v_written is null then
    raise exception 'Buying-cost event or identical quote already exists'
      using errcode='22023';
  end if;
  return jsonb_build_object(
    'eventId',p_event_id,'businessId',p_business_id,
    'catalogueProductId',p_catalogue_product_id,
    'costPrice',p_cost_price,'effectiveOn',p_effective_on
  );
end;
$record_cost$;
revoke all on function public.record_business_buying_cost(
 uuid,uuid,uuid,integer,date
) from public,anon,authenticated,service_role;
commit;
