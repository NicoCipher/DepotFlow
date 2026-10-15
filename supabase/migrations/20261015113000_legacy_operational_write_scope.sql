-- M2d-1: protect and scope NEW writes for the existing single-owner
-- test workspace AFTER its audited M2b backfill and M2c FK validation.
--
-- Installing this migration alone DOES NOT switch stamping on, change RLS,
-- grant account access, or enable signup. All financial/receipt semantics
-- continue to be provided by the existing atomic application RPCs.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.legacy_write_scope_gate (
  singleton boolean primary key default true check (singleton),
  business_id uuid not null unique references private.businesses(id) on delete restrict,
  enabled boolean not null default false,
  enabled_at timestamptz
);
alter table private.legacy_write_scope_gate enable row level security;
revoke all on private.legacy_write_scope_gate
  from public, anon, authenticated, service_role;

-- Runs as an internal trigger function, not a user-callable public RPC.
-- Every write is checked against a real Auth user and an ACTIVE membership.
-- It never trusts a business identifier or authorization hint from the client.
create function private.scope_legacy_operational_write()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  v_business uuid;
  v_actor uuid;
begin
  select g.business_id into v_business
  from private.legacy_write_scope_gate g
  where g.enabled is true
  for share;
  if v_business is null then
    -- Existing owner-only operation remains unchanged until a reviewed
    -- backfill + manual activation. No other business may sign up yet.
    if tg_op='DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_actor := auth.uid();
  -- Lock the authorization rows until the write transaction completes.
  -- A concurrent owner revocation or suspension cannot sneak in after check.
  if v_actor is null then
    raise exception 'A verified owner session is required for shop writes'
      using errcode='42501';
  end if;
  perform 1 from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    join private.shop_owner so on so.user_id=m.user_id
    where m.business_id=v_business and m.user_id=v_actor
      and m.member_kind='owner' and m.status='active'
      and b.legacy_singleton is true and b.status='active'
    for share of m,b,so;
  if not found then
    raise exception 'Only the verified active legacy owner may change shop records'
      using errcode='42501';
  end if;

  if tg_op='DELETE' then
    if old.business_id is distinct from v_business then
      raise exception 'Cannot delete another business record'
        using errcode='42501';
    end if;
    return old;
  elsif tg_op='UPDATE' then
    if old.business_id is distinct from v_business
       or new.business_id is distinct from old.business_id then
      raise exception 'Operational business identity cannot be changed'
        using errcode='42501';
    end if;
  elsif new.business_id is not null
        and new.business_id is distinct from v_business then
    raise exception 'An operational record cannot belong to another business'
      using errcode='42501';
  end if;
  new.business_id := v_business;
  return new;
end;
$$;
revoke all on function private.scope_legacy_operational_write()
  from public, anon, authenticated, service_role;

do $install$
declare
  r record;
  v_total int:=0;
begin
  for r in select * from private.legacy_scope_tables() loop
    execute pg_catalog.format(
      'create trigger legacy_scope_business_write
       before insert or update or delete on %I.%I
       for each row execute function private.scope_legacy_operational_write()',
      r.schema_name,r.table_name
    );
    v_total:=v_total+1;
  end loop;
  if v_total<>29 then
    raise exception 'M2d expected 29 operational write triggers; found %',v_total;
  end if;
end;
$install$;

-- The shared master catalogue is NOT tenant-owned and must not receive
-- business_id. Nevertheless, its one authenticated edit surface (image_path)
-- must lose write access if the old owner is suspended after gate activation.
-- Keep the legacy owner policy for preactivation compatibility; the trigger
-- hardens it without changing catalogue ownership or admin seed imports.
create function private.guard_legacy_catalogue_image_write()
returns trigger
language plpgsql security definer set search_path=''
as $
declare
  v_business uuid;
  v_actor uuid;
begin
  select g.business_id into v_business
  from private.legacy_write_scope_gate g
  where g.enabled is true
  for share;
  if v_business is null then
    return new;
  end if;
  v_actor := auth.uid();
  if v_actor is null then
    raise exception 'A verified owner session is required for catalogue photo updates'
      using errcode='42501';
  end if;
  perform 1 from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    join private.shop_owner so on so.user_id=m.user_id
    where m.business_id=v_business and m.user_id=v_actor
      and m.member_kind='owner' and m.status='active'
      and b.legacy_singleton is true and b.status='active'
    for share of m,b,so;
  if not found then
    raise exception 'Only the verified active legacy owner may update a catalogue photo'
      using errcode='42501';
  end if;
  return new;
end;
$;
revoke all on function private.guard_legacy_catalogue_image_write()
  from public, anon, authenticated, service_role;

create trigger legacy_scope_catalogue_image_write
  before update of image_path on public.product_catalogue
  for each row execute function private.guard_legacy_catalogue_image_write();

-- Administrative, SECURITY INVOKER activation: a manually approved snapshot
-- of all 29 tables must match exactly, with no NULL or foreign tags. Holds
-- table locks to prevent a write racing the readiness check. All M2c tenant
-- relationship constraints must already be validated.
create function private.enable_legacy_write_scope(p_expected_snapshot jsonb)
returns uuid
language plpgsql security invoker set search_path=''
as $$
declare
  r record;
  v_owner uuid;
  v_business uuid;
  v_current jsonb;
  v_key text;
  v_validated integer;
begin
  if p_expected_snapshot is null
     or pg_catalog.jsonb_typeof(p_expected_snapshot)<>'object' then
    raise exception 'A reviewed M2b inventory snapshot is required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(81015,610);

  lock table private.businesses, private.business_memberships,
    private.shop_owner, private.legacy_write_scope_gate
    in share row exclusive mode;

  if (select count(*) from private.shop_owner)<>1
     or (select count(*) from private.businesses)<>1
     or (select count(*) from private.business_memberships)<>1 then
    raise exception 'Legacy write scope requires exactly one owner and one business';
  end if;
  select so.user_id,b.id into v_owner,v_business
  from private.shop_owner so
  join private.business_memberships m on m.user_id=so.user_id
  join private.businesses b on b.id=m.business_id
  where m.status='active' and m.member_kind='owner'
    and b.legacy_singleton is true and b.status='active';

  if v_business is null or not exists (
    select 1 from auth.users where id=v_owner
  ) then
    raise exception 'Active Auth owner and legacy business linkage required';
  end if;
  if exists (
    select 1 from private.legacy_write_scope_gate g
    where g.business_id<>v_business
  ) then
    raise exception 'Cannot reassign the write gate to a different business';
  end if;

  for r in select * from private.legacy_scope_tables() loop
    execute pg_catalog.format(
      'lock table %I.%I in share row exclusive mode',
      r.schema_name,r.table_name
    );
  end loop;
  v_current := private.legacy_scope_snapshot();
  if v_current<>p_expected_snapshot then
    raise exception 'Operational inventory changed since owner review';
  end if;
  for r in select * from private.legacy_scope_tables() loop
    v_key := r.schema_name||'.'||r.table_name;
    if (v_current->v_key->>'unassigned')::bigint<>0
       or (v_current->v_key->>'foreign')::bigint<>0
       or (v_current->v_key->>'legacy')::bigint
           <> (v_current->v_key->>'total')::bigint then
      raise exception 'All historical rows must be reconciled first: %',v_key;
    end if;
  end loop;
  select count(*) into v_validated from pg_constraint c
  where c.contype='f' and c.conname like 'tenant_%'
    and c.convalidated is true;
  if v_validated<>31 then
    raise exception '31 M2c tenant foreign keys must be validated first (found %)',
      v_validated;
  end if;

  insert into private.legacy_write_scope_gate
    (singleton,business_id,enabled,enabled_at)
  values (true,v_business,true,pg_catalog.now())
  on conflict (singleton) do update
    set enabled=true,enabled_at=coalesce(
      private.legacy_write_scope_gate.enabled_at,excluded.enabled_at)
    where private.legacy_write_scope_gate.business_id=excluded.business_id;
  if not exists(
    select 1 from private.legacy_write_scope_gate
    where business_id=v_business and enabled is true
  ) then
    raise exception 'Legacy write gate could not be activated';
  end if;
  return v_business;
end;
$$;
revoke all on function private.enable_legacy_write_scope(jsonb)
  from public, anon, authenticated, service_role;
commit;
