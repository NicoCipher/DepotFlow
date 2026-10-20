-- M2d-2: close legacy owner-only READ policies after membership revocation.
-- This is additive to M2d-1. No new tenant gets legacy workspace access.
-- The read predicates behave identically to the original singleton check
-- UNTIL the explicit M2d-1 gate has been enabled by an administrator.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- A private SECURITY DEFINER boolean predicate avoids RLS recursion while
-- reading the private membership registry. Never return an owner ID, customer
-- record, or business row; callers only learn whether THEIR Auth identity
-- may read the legacy workspace at this moment.
create function private.verified_legacy_owner_read()
returns boolean
language plpgsql stable security definer set search_path=''
as $$
declare
  v_actor uuid;
  v_business uuid;
begin
  v_actor:=auth.uid();
  if v_actor is null then return false; end if;

  select g.business_id into v_business
  from private.legacy_write_scope_gate g where g.enabled is true;

  if v_business is null then
    -- Existing authenticated single-shop pilot: no behaviour change.
    return exists(
      select 1 from private.shop_owner so where so.user_id=v_actor
    );
  end if;

  return exists(
    select 1 from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    join private.shop_owner so on so.user_id=m.user_id
    where m.business_id=v_business and m.user_id=v_actor
      and m.member_kind='owner' and m.status='active'
      and b.legacy_singleton is true and b.status='active'
  );
end;
$$;
revoke all on function private.verified_legacy_owner_read()
  from public,anon,authenticated,service_role;
grant execute on function private.verified_legacy_owner_read()
  to authenticated;

-- All existing uses of is_shop_owner() (including UPDATE policy predicates)
-- now honor the activated gate, without changing the function's name,
-- parameters, stability, or the legacy identity contract.
create or replace function public.is_shop_owner()
returns boolean
language sql stable security invoker set search_path=''
as $$
  select private.verified_legacy_owner_read();
$$;

-- Repoint all currently exposed owner-only SELECT policies to the same
-- verified predicate. Merely updating is_shop_owner() is NOT sufficient:
-- 16+ older policies embed EXISTS(private.shop_owner) inline.
-- Preserve the extra per-user ownership check for both historical price
-- ledgers; they must never show another user's records.
do $policies$
declare
  r record;
  v_count int:=0;
  v_expected_count int;
  v_rls_count int;
  v_private_count int:=0;
  v_expr text;
  -- Both original-shop installation histories are supported. One shipped
  -- with 26 owner-read policies, while live's 55-migration history has 27.
  -- Never accept an arbitrary extra owner_read policy merely to match a
  -- count: validate the exact table/policy/role/owner predicate first.
  v_expected_tables text[]:=array[
    'bottle_deposit_price','bottle_obligations','crate_deposit_prices',
    'crate_obligations','crate_swap_rules','crate_types',
    'customer_opening_balances','customer_payments','customers','deposits',
    'empty_bottle_stock','empty_crate_movements','empty_crate_stock',
    'money_owed','product_catalogue','product_cost_history',
    'product_selling_price_history','products',
    'sale_empty_bottle_returns','sale_empty_crate_returns',
    'sale_empty_decisions','sale_items','sale_tender_legs','sales',
    'shop_profile','stock','stock_movements'
  ];
begin
  -- Fail BEFORE any policy rewrite if a protected table has RLS disabled.
  -- PostgreSQL accepts ALTER POLICY on a table with relrowsecurity=false,
  -- but does not enforce that policy; direct SELECT grants would then leak
  -- every original-shop row to any authenticated account.
  --
  -- The ONLY supported 26-policy history is the one with no
  -- public.sale_tender_legs relation at all. A missing policy on an
  -- existing relation is NOT a recognized older schema.
  v_expected_count:=case
    when pg_catalog.to_regclass('public.sale_tender_legs') is null then 26
    else 27
  end;
  select count(*) into v_rls_count
  from pg_catalog.pg_class cls
  join pg_catalog.pg_namespace ns on ns.oid=cls.relnamespace
  where ns.nspname='public'
    and cls.relname=any(v_expected_tables)
    and cls.relkind in ('r','p')
    and cls.relrowsecurity is true;
  if v_rls_count<>v_expected_count then
    raise exception
      'Protected owner-read tables missing or have row level security disabled: % enabled; expected %',
      v_rls_count,v_expected_count using errcode='42501';
  end if;

  -- private.shop_owner has a direct authenticated SELECT grant. Check its
  -- entire read-capable policy roster too: an extra permissive SELECT/ALL
  -- policy would OR around the owner-revocation predicate.
  if not exists(
    select 1
    from pg_catalog.pg_class cls
    join pg_catalog.pg_namespace ns on ns.oid=cls.relnamespace
    where ns.nspname='private' and cls.relname='shop_owner'
      and cls.relrowsecurity is true and cls.relkind in ('r','p')
  ) then
    raise exception 'Original shop owner registry RLS is not enabled'
      using errcode='42501';
  end if;

  for r in
    -- Every read-capable policy on a protected table must be examined.
    -- Permissive RLS policies are ORed: an extra USING(true), under ANY
    -- name, undoes the otherwise correct owner_read rewrite. FOR ALL ('*')
    -- policies also grant SELECT and must not slip past the roster.
    -- Continue detecting moved/duplicate owner-read policy names outside
    -- protected tables so a matching count cannot hide table drift.
    select pol.polname,cls.relname,ns.nspname as schema_name,
      pol.polroles,pol.polcmd,pol.polpermissive,
      pg_catalog.pg_get_expr(pol.polqual,pol.polrelid) as policy_using
    from pg_catalog.pg_policy pol
    join pg_catalog.pg_class cls on cls.oid=pol.polrelid
    join pg_catalog.pg_namespace ns on ns.oid=cls.relnamespace
    where (
       ns.nspname='public' and (
         (cls.relname=any(v_expected_tables) and pol.polcmd in ('r','*'))
         or (pol.polcmd in ('r','*') and pol.polname
              in ('owner_read','owner_profile','owner_empty_choices'))
       )
    ) or (
       ns.nspname='private' and cls.relname='shop_owner'
       and pol.polcmd in ('r','*')
    )
  loop
    if r.schema_name='private' then
      if r.relname<>'shop_owner'
        or r.polname<>'owner_can_read_own_configuration'
        or r.polcmd<>'r' or r.polpermissive is distinct from true
        or r.polroles is distinct from array['authenticated'::regrole::oid]
        or coalesce(r.policy_using,'') !~ 'user_id'
      then
        raise exception 'Unexpected private shop owner read policy on %.%',
          r.relname,r.polname using errcode='42501';
      end if;
      v_private_count:=v_private_count+1;
      continue;
    end if;
    if r.polcmd<>'r' or r.polpermissive is distinct from true
      or r.relname <> all(v_expected_tables)
      or (r.relname='shop_profile' and r.polname<>'owner_profile')
      or (r.relname='sale_empty_decisions' and r.polname<>'owner_empty_choices')
      or (r.relname not in ('shop_profile','sale_empty_decisions')
          and r.polname<>'owner_read')
      or r.polroles is distinct from array['authenticated'::regrole::oid]
      or coalesce(r.policy_using,'') !~ 'shop_owner'
      or (r.relname in ('product_cost_history','product_selling_price_history')
          and coalesce(r.policy_using,'') !~ 'owner_user_id')
    then
      raise exception 'Unexpected owner-read policy identity or grant on %.%',
        r.relname,r.polname using errcode='42501';
    end if;
    v_expr:='(select public.is_shop_owner())';
    if r.relname in ('product_cost_history','product_selling_price_history') then
      v_expr:=v_expr||' and owner_user_id=(select auth.uid())';
    end if;
    execute pg_catalog.format(
      'alter policy %I on public.%I using (%s)',
      r.polname,r.relname,v_expr
    );
    v_count:=v_count+1;
  end loop;
  if v_count<>v_expected_count then
    raise exception
      'Expected exact % authenticated owner-only SELECT policies for this schema, found %',
      v_expected_count,v_count using errcode='42501';
  end if;
  if v_private_count<>1 then
    raise exception 'Expected exactly one private shop_owner SELECT policy, found %',
      v_private_count using errcode='42501';
  end if;
end;
$policies$;

-- A revoked owner also loses visibility of private.shop_owner metadata;
-- checking the membership from the definer helper cannot recurse through
-- this row's RLS policy.
alter policy owner_can_read_own_configuration on private.shop_owner
  using (
    user_id=(select auth.uid()) and (select public.is_shop_owner())
  );
commit;
