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
  v_expr text;
begin
  for r in
    select pol.polname,cls.relname
    from pg_catalog.pg_policy pol
    join pg_catalog.pg_class cls on cls.oid=pol.polrelid
    join pg_catalog.pg_namespace ns on ns.oid=cls.relnamespace
    where ns.nspname='public' and pol.polcmd='r'
      and pol.polname in ('owner_read','owner_profile','owner_empty_choices')
  loop
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
  if v_count<>26 then
    raise exception 'Expected exactly 26 existing public owner-only SELECT policies, found %',
      v_count;
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
