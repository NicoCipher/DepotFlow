-- M2f-10: stage exact branded crate counts per verified business.
-- Release remains NO-GO; no new-business sales/returns/receiving.
-- The RPC has NO browser permission and the admin gate starts disabled.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $crate_scope_preflight$
begin
  if not exists (
    select 1 from pg_constraint c
    where c.conrelid='public.empty_crate_stock'::regclass
      and c.contype='f'
      and c.conname like 'tenant_%'
      and c.confrelid='public.crate_types'::regclass
  ) then
    raise exception 'Business-qualified crate stock/type FK missing';
  end if;
  if (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid='public.empty_crate_stock'::regclass and contype='p')
     <> 'PRIMARY KEY (crate_type_id)' then
    raise exception 'Crate stock global UUID key unexpectedly changed';
  end if;
end;
$crate_scope_preflight$;

create table private.business_crate_count_gate (
  singleton boolean primary key default true check (singleton is true),
  enabled boolean not null default false
);
insert into private.business_crate_count_gate(singleton,enabled)
 values(true,false);
alter table private.business_crate_count_gate enable row level security;
revoke all on private.business_crate_count_gate
 from public,anon,authenticated,service_role;

create table private.business_empty_crate_counts (
  business_id uuid not null references private.businesses(id) on delete restrict,
  request_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  crate_type_id uuid not null,
  expected_quantity integer not null check (expected_quantity>=0),
  previous_quantity integer not null check (previous_quantity>=0),
  new_quantity integer not null check (new_quantity>=0),
  business_date date not null,
  created_at timestamptz not null default now(),
  primary key (business_id, request_id),
  foreign key (business_id,crate_type_id)
    references public.crate_types(business_id,id) on delete restrict
);
alter table private.business_empty_crate_counts enable row level security;
revoke all on private.business_empty_crate_counts
 from public,anon,authenticated,service_role;

-- Extend ONLY the already-staged count branch to another exact physical
-- stock table. All other SQL writes still follow the old owner-only path.
do $extend_exact_empty_count_scope$
declare
  v_oid oid := 'private.scope_legacy_operational_write()'::regprocedure;
  v_source text;
  v_old_when constant text := $oldwhen$
if tg_table_schema='public' and tg_table_name='empty_bottle_stock'
     and tg_op in ('INSERT','UPDATE')$oldwhen$;
  v_new_when constant text := $newwhen$
if tg_table_schema='public' and tg_table_name in ('empty_bottle_stock','empty_crate_stock')
     and tg_op in ('INSERT','UPDATE')$newwhen$;
  v_old_gate constant text := $oldgate$
    if not exists (
      select 1 from private.business_bottle_count_gate where enabled is true
    ) then
      raise exception 'Business empty-bottle counting is not available'
        using errcode='42501';
    end if;$oldgate$;
  v_new_gate constant text := $gate$
    if tg_table_name='empty_bottle_stock' and not exists (
      select 1 from private.business_bottle_count_gate where enabled is true
    ) then
      raise exception 'Business empty-bottle counting is not available'
        using errcode='42501';
    elsif tg_table_name='empty_crate_stock' and not exists (
      select 1 from private.business_crate_count_gate where enabled is true
    ) then
      raise exception 'Business empty-crate counting is not available'
        using errcode='42501';
    end if;
$gate$;
begin
  v_source:=pg_catalog.pg_get_functiondef(v_oid);
  if v_source is null or
     (length(v_source)-length(replace(v_source,v_old_when,'')))/length(v_old_when)<>1 or
     (length(v_source)-length(replace(v_source,v_old_gate,'')))/length(v_old_gate)<>1 then
    raise exception 'Business physical-empty write trigger drift: when %, gate %',
      (length(v_source)-length(replace(v_source,v_old_when,'')))/length(v_old_when),
      (length(v_source)-length(replace(v_source,v_old_gate,'')))/length(v_old_gate);
  end if;
  v_source:=replace(v_source,v_old_when,v_new_when);
  v_source:=replace(v_source,v_old_gate,v_new_gate);
  v_source:=replace(v_source,
     'Bottle stock business identity cannot be changed',
     'Physical empty stock business identity cannot be changed');
  execute v_source;
end;
$extend_exact_empty_count_scope$;

-- Crate identity is the shop-owned crate UUID, NEVER its 12/20/24 pockets.
-- Keep Gulder/Heineken separate even when their sizes match.
create function public.count_business_empty_crates(
  p_business_id uuid,
  p_request_id uuid,
  p_crate_type_id uuid,
  p_quantity integer,
  p_expected_quantity integer,
  p_business_date date
) returns jsonb
language plpgsql security definer set search_path=''
as $count$
declare
  v_actor uuid;
  v_crate_name text;
  v_previous integer;
  v_written uuid;
  v_event private.business_empty_crate_counts%rowtype;
begin
  v_actor:=auth.uid();
  if v_actor is null or p_business_id is null then
    raise exception 'Verified business owner session required'
      using errcode='42501';
  end if;
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
    select 1 from private.business_crate_count_gate where enabled is true
  ) then
    raise exception 'Business empty-crate counting is not available'
      using errcode='42501';
  end if;
  if p_request_id is null or p_crate_type_id is null
     or p_business_date is null or p_quantity is null or p_quantity<0
     or p_expected_quantity is null or p_expected_quantity<0 then
    raise exception 'Check the empty crate type and count'
      using errcode='22023';
  end if;

  -- Verify exact crate ownership before any lookup/upsert of physical stock.
  select name into v_crate_name from public.crate_types
    where id=p_crate_type_id and business_id=p_business_id
      and is_legacy is false
    for share;
  if not found then
    raise exception 'Crate type not available'
      using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_business_id::text||':'||p_request_id::text,0)
  );

  select * into v_event from private.business_empty_crate_counts
    where business_id=p_business_id and request_id=p_request_id
    for update;
  if found then
    if v_event.crate_type_id<>p_crate_type_id
       or v_event.new_quantity<>p_quantity
       or v_event.expected_quantity<>p_expected_quantity
       or v_event.business_date<>p_business_date then
      raise exception 'This empty-crate count request was already used'
        using errcode='22023';
    end if;
    return jsonb_build_object(
      'requestId',p_request_id,'businessId',p_business_id,
      'crateTypeId',p_crate_type_id,'previous',v_event.previous_quantity,
      'quantity',v_event.new_quantity);
  end if;

  select quantity into v_previous from public.empty_crate_stock
    where business_id=p_business_id and crate_type_id=p_crate_type_id
    for update;
  v_previous:=coalesce(v_previous,0);
  if v_previous<>p_expected_quantity then
    raise exception 'Empty crate counts changed. Refresh and check again.'
      using errcode='22023';
  end if;

  insert into public.empty_crate_stock(
    crate_type_id,crate_type,business_id,quantity
  ) values(p_crate_type_id,v_crate_name,p_business_id,p_quantity)
    on conflict(crate_type_id) do update
      set quantity=excluded.quantity
    where public.empty_crate_stock.business_id=p_business_id
      and public.empty_crate_stock.quantity=p_expected_quantity
    returning crate_type_id into v_written;
  if v_written is null then
    raise exception 'Empty crate counts changed. Refresh and check again.'
      using errcode='22023';
  end if;

  insert into private.business_empty_crate_counts(
    business_id,request_id,actor_id,crate_type_id,expected_quantity,
    previous_quantity,new_quantity,business_date
  ) values(
    p_business_id,p_request_id,v_actor,p_crate_type_id,p_expected_quantity,
    v_previous,p_quantity,p_business_date
  );
  return jsonb_build_object(
    'requestId',p_request_id,'businessId',p_business_id,
    'crateTypeId',p_crate_type_id,'previous',v_previous,'quantity',p_quantity);
end;
$count$;
revoke all on function public.count_business_empty_crates(
 uuid,uuid,uuid,integer,integer,date
) from public,anon,authenticated,service_role;

commit;
