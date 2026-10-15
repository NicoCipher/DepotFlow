-- M2e-2: use the EXISTING customers table for new businesses.
-- Do NOT introduce a second customer database. No owner enrollment is enabled
-- and no financial/stock/sale RPC is opened to nonlegacy owners.
-- A new owner's customer writes work only AFTER manual legacy backfill and
-- explicit activation of the M2d-1 gate (requires exactly one business then).
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Keep customer row identity rooted in the verified active owner. An original
-- shop user sees only the legacy NULL rows before backfill, or its own business
-- rows after the gate is enabled. The old unrestricted owner_read predicate
-- must NEVER expose the new owner's customer rows.
create function private.can_read_legacy_customer(p_business_id uuid)
returns boolean
language plpgsql stable security definer set search_path=''
as $legacy$
declare
  v_legacy uuid;
begin
  if not private.verified_legacy_owner_read() then
    return false;
  end if;
  select g.business_id into v_legacy
  from private.legacy_write_scope_gate g
  where g.enabled is true;
  if v_legacy is null then
    -- During the audited M2b backfill, legacy customers may already be
    -- tagged while M2d activation is still disabled. Keep only the verified
    -- legacy owner able to read both old NULL-tagged and newly tagged
    -- legacy rows; NEVER expose a nonlegacy business.
    return p_business_id is null
       or exists (
         select 1 from private.businesses b
         where b.id=p_business_id and b.legacy_singleton is true
           and b.status='active'
       );
  end if;
  return p_business_id=v_legacy;
end;
$legacy$;
revoke all on function private.can_read_legacy_customer(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.can_read_legacy_customer(uuid)
  to authenticated;

-- The first new business profile can be configured before activation, but
-- NO new-business customers may be created/read until the test shop has been
-- reconciled. This is also the update-time RLS barrier.
create function private.can_manage_new_customer(p_business_id uuid)
returns boolean
language sql stable security definer set search_path=''
as $new_customer$
  select p_business_id is not null
    and exists (select 1 from private.legacy_write_scope_gate g
                where g.enabled is true)
    and private.owns_new_business(p_business_id);
$new_customer$;
revoke all on function private.can_manage_new_customer(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.can_manage_new_customer(uuid)
  to authenticated;

-- This is an intentionally narrow extension of M2d-1's existing trigger.
-- The legacy path is copied unchanged, including the strict old-owner
-- authorization, no retagging, and its per-table guard on all 29 tables.
create or replace function private.scope_legacy_operational_write()
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

  -- M2e-2: customers is the ONLY operational table accepting a new
  -- business identity. Everything else remains legacy owner-only until its
  -- financial/stock/empties transaction paths are separately isolated.
  -- Activation must already have backfilled the original shop (above).
  if tg_table_schema='public' and tg_table_name='customers'
     and tg_op in ('INSERT','UPDATE') and new.business_id is not null
     and new.business_id is distinct from v_business then
    if tg_op='UPDATE' and old.business_id is distinct from new.business_id then
      raise exception 'Customer business identity cannot be changed'
        using errcode='42501';
    end if;

    v_actor := auth.uid();
    if v_actor is null then
      raise exception 'Verified business owner session required'
        using errcode='42501';
    end if;
    -- Row-share locks make revocation/suspension wait until the
    -- customer transaction finishes. Never trust the caller's business
    -- id alone: it MUST be paired to auth.uid() in the private registry.
    perform 1 from private.business_memberships m
      join private.businesses b on b.id=m.business_id
      where m.business_id=new.business_id and m.user_id=v_actor
        and m.member_kind='owner' and m.status='active'
        and b.status in ('setup','active')
        and b.legacy_singleton is null
      for share of m,b;
    if not found then
      raise exception 'Cannot write another business customer'
        using errcode='42501';
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

-- The same authenticated INSERT column set as the legacy customer editor
-- plus business_id for new owners. No grant to set created_at or delete.
grant insert(business_id) on public.customers to authenticated;

-- Update the EXISTING policies, not add permissive OR policies that would
-- accidentally retain global is_shop_owner() visibility of new businesses.
alter policy owner_read on public.customers
  using (
    private.can_read_legacy_customer(business_id)
    or private.can_manage_new_customer(business_id)
  );

alter policy owner_insert_customer on public.customers
  with check (
    private.can_read_legacy_customer(business_id)
    or private.can_manage_new_customer(business_id)
  );

alter policy owner_update_customer on public.customers
  using (
    private.can_read_legacy_customer(business_id)
    or private.can_manage_new_customer(business_id)
  )
  with check (
    private.can_read_legacy_customer(business_id)
    or private.can_manage_new_customer(business_id)
  );

-- Updating a customer never grants changing their business_id. The existing
-- per-column update grants exclude it; the guarded trigger also prohibits
-- moving an existing customer between new businesses.
commit;
