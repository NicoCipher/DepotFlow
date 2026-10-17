-- M2f-9: the first scoped physical-empty WRITE primitive for new businesses.
-- Draft-only. Not a new-shop sales/returns release or production deployment.
-- Default-off gate + NO authenticated RPC GRANT until an approved cutover.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.business_bottle_count_gate (
  singleton boolean primary key default true check (singleton is true),
  enabled boolean not null default false
);
insert into private.business_bottle_count_gate(singleton,enabled)
values (true,false);
alter table private.business_bottle_count_gate enable row level security;
revoke all on private.business_bottle_count_gate from public,anon,authenticated,service_role;

create table private.business_empty_bottle_counts (
  business_id uuid not null references private.businesses(id) on delete restrict,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  bottle_type text not null check (length(pg_catalog.btrim(bottle_type)) between 1 and 120),
  expected_quantity integer not null check (expected_quantity>=0),
  previous_quantity integer not null check (previous_quantity>=0),
  new_quantity integer not null check (new_quantity>=0),
  business_date date not null,
  created_at timestamptz not null default now(),
  primary key (business_id, request_id)
);
alter table private.business_empty_bottle_counts enable row level security;
revoke all on private.business_empty_bottle_counts from public,anon,authenticated,service_role;

-- Preserve legacy owner writes exactly. Widen ONLY the trigger branch for
-- owned empty_bottle_stock INSERT/UPDATE when an internal rollout gate is on.
-- The physical-stock table itself keeps all DML revoked for authenticated.
do $install_scoped_bottle_count$
declare
  v_oid oid := 'private.scope_legacy_operational_write()'::regprocedure;
  v_source text;
  v_anchor constant text := E'\n  v_actor := auth.uid();\n  -- Lock the authorization rows until the write transaction completes.';
  v_branch constant text := $guard$
  -- New depots may count THEIR OWN exact branded empty bottles only once
  -- the separate count rollout has been explicitly approved and enabled.
  if tg_table_schema='public' and tg_table_name='empty_bottle_stock'
     and tg_op in ('INSERT','UPDATE')
     and new.business_id is not null
     and new.business_id is distinct from v_business then
    if tg_op='UPDATE' and old.business_id is distinct from new.business_id then
      raise exception 'Bottle stock business identity cannot be changed'
        using errcode='42501';
    end if;
    if not exists (
      select 1 from private.business_bottle_count_gate where enabled is true
    ) then
      raise exception 'Business empty-bottle counting is not available'
        using errcode='42501';
    end if;
    v_actor := auth.uid();
    if v_actor is null then
      raise exception 'Verified business owner session required'
        using errcode='42501';
    end if;
    perform 1 from private.business_memberships m
      join private.businesses b on b.id=m.business_id
      where m.business_id=new.business_id and m.user_id=v_actor
        and m.member_kind='owner' and m.status='active'
        and b.status in ('setup','active')
        and b.legacy_singleton is null
      for share of m,b;
    if not found then
      raise exception 'Cannot count another business empty bottles'
        using errcode='42501';
    end if;
    return new;
  end if;

$guard$;
begin
  select pg_catalog.pg_get_functiondef(v_oid) into v_source;
  if v_source is null
    or (length(v_source)-length(replace(v_source,v_anchor,'')))/length(v_anchor)<>1
    or pg_catalog.strpos(v_source,'tg_table_name=''customers''')=0
    or pg_catalog.strpos(v_source,'private.business_bottle_count_gate')<>0 then
    raise exception 'Operational scope trigger drift; manual review required';
  end if;
  execute replace(v_source,v_anchor,v_branch||v_anchor);
end;
$install_scoped_bottle_count$;

-- Money, sale receipts, stock receiving, crate and customer returns remain
-- restricted to the original verified single owner pending their own review.
create function public.count_business_empty_bottles(
  p_business_id uuid,
  p_request_id uuid,
  p_bottle_type text,
  p_quantity integer,
  p_expected_quantity integer,
  p_business_date date
) returns jsonb
language plpgsql security definer set search_path=''
as $count$
declare
  v_actor uuid;
  v_previous integer;
  v_written uuid;
  v_event private.business_empty_bottle_counts%rowtype;
  v_bottle_type text;
begin
  v_actor:=auth.uid();
  if v_actor is null or p_business_id is null then
    raise exception 'Verified business owner session required'
      using errcode='42501';
  end if;
  -- Membership check precedes ALL stock, request-ID and audit lookups.
  -- Keep authorization rows locked against concurrent revocation.
  perform 1 from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    where m.business_id=p_business_id and m.user_id=v_actor
      and m.member_kind='owner' and m.status='active'
      and b.legacy_singleton is null and b.status in ('setup','active')
    for share of m,b;
  if not found then
    raise exception 'Business not available' using errcode='42501';
  end if;
  if not exists(
    select 1 from private.legacy_write_scope_gate where enabled is true
  ) or not exists(
    select 1 from private.business_bottle_count_gate where enabled is true
  ) then
    raise exception 'Business empty-bottle counting is not available'
      using errcode='42501';
  end if;
  if p_request_id is null or p_business_date is null
     or p_bottle_type is null
     or length(pg_catalog.btrim(p_bottle_type)) not between 1 and 120
     or p_quantity is null or p_quantity<0
     or p_expected_quantity is null or p_expected_quantity<0 then
    raise exception 'Check the empty bottle type and count'
      using errcode='22023';
  end if;
  v_bottle_type:=pg_catalog.btrim(p_bottle_type);
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_business_id::text||':'||p_request_id::text,0)
  );

  select * into v_event from private.business_empty_bottle_counts
    where business_id=p_business_id and request_id=p_request_id
    for update;
  if found then
    if v_event.bottle_type<>v_bottle_type
       or v_event.expected_quantity<>p_expected_quantity
       or v_event.new_quantity<>p_quantity
       or v_event.business_date<>p_business_date then
      raise exception 'This empty-bottle count request was already used'
        using errcode='22023';
    end if;
    -- An idempotent replay returns ORIGINAL count, not current inventory.
    return jsonb_build_object(
      'requestId',p_request_id,'businessId',p_business_id,
      'bottleType',v_bottle_type,'previous',v_event.previous_quantity,
      'quantity',v_event.new_quantity);
  end if;

  select quantity into v_previous from public.empty_bottle_stock
    where business_id=p_business_id and bottle_type=v_bottle_type
    for update;
  v_previous:=coalesce(v_previous,0);
  if v_previous<>p_expected_quantity then
    raise exception 'Empty bottle counts changed. Refresh and check again.'
      using errcode='22023';
  end if;

  -- Explicit conflict target is business-qualified. Concurrent first counts
  -- of the same bottle type cannot combine inventories or overwrite stale
  -- expected quantities. The row trigger repeats membership verification.
  insert into public.empty_bottle_stock(business_id,bottle_type,quantity)
    values(p_business_id,v_bottle_type,p_quantity)
    on conflict(business_id,bottle_type) do update
      set quantity=excluded.quantity
    where public.empty_bottle_stock.quantity=p_expected_quantity
    returning stock_id into v_written;
  if v_written is null then
    raise exception 'Empty bottle counts changed. Refresh and check again.'
      using errcode='22023';
  end if;

  insert into private.business_empty_bottle_counts(
    business_id,request_id,actor_id,bottle_type,expected_quantity,
    previous_quantity,new_quantity,business_date
  ) values (
    p_business_id,p_request_id,v_actor,v_bottle_type,p_expected_quantity,
    v_previous,p_quantity,p_business_date
  );
  return jsonb_build_object(
    'requestId',p_request_id,'businessId',p_business_id,
    'bottleType',v_bottle_type,'previous',v_previous,'quantity',p_quantity);
end;
$count$;
revoke all on function public.count_business_empty_bottles(
 uuid,uuid,text,integer,integer,date
) from public,anon,authenticated,service_role;

commit;
