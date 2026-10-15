-- M2d-3a: repair admin backfill ordering after M2c composite FKs.
-- New shadow FKs enforce INSERT and UPDATE immediately even when NOT VALID.
-- Updating dependent rows alphabetically can fail when the parent has not
-- received its legacy business_id yet. This migration only redefines the
-- unexposed admin routine: no automatic backfill, no changes to production
-- records, grants, membership, or active gate.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function private.backfill_legacy_shop_rows(p_expected_snapshot jsonb)
returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare
  v_business uuid;
  v_owner uuid;
  v_row record;
  v_key text;
  v_current jsonb;
  v_after jsonb;
  v_assigned bigint := 0;
  v_updated bigint;
begin
  if p_expected_snapshot is null
     or pg_catalog.jsonb_typeof(p_expected_snapshot) <> 'object' then
    raise exception 'An approved JSON object snapshot is required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(81015, 610);
  -- Freeze ownership metadata too: another admin cannot create an owner or
  -- business between the singleton check and our table-wide backfill.
  lock table private.businesses, private.business_memberships,
    private.shop_owner in share row exclusive mode;
  if (select count(*) from private.businesses) <> 1
     or (select count(*) from private.shop_owner) <> 1
     or (select count(*) from private.business_memberships) <> 1 then
    raise exception 'Backfill only supports the single-owner legacy-only stage';
  end if;
  select user_id into v_owner from private.shop_owner;
  select b.id into v_business
  from private.businesses b
  join private.business_memberships m on m.business_id=b.id
  where b.legacy_singleton is true and b.status='active'
    and m.user_id=v_owner and m.member_kind='owner'
    and m.status='active';
  if v_business is null
     or not exists(select 1 from auth.users where id=v_owner) then
    raise exception 'Verified active legacy ownership is required';
  end if;
  if (select count(*) from private.legacy_scope_tables()) <> 29 then
    raise exception 'Scoped table inventory changed; review before backfill';
  end if;

  -- SHARE ROW EXCLUSIVE prevents concurrent app INSERT/UPDATE/DELETE while
  -- allowing read-only reporting. Caller must commit/rollback deliberately.
  for v_row in select * from private.legacy_scope_tables() loop
    execute pg_catalog.format('lock table %I.%I in share row exclusive mode',
      v_row.schema_name,v_row.table_name);
  end loop;
  v_current := private.legacy_scope_snapshot();
  if v_current <> p_expected_snapshot then
    raise exception 'Legacy inventory changed since review; no rows updated';
  end if;
  for v_row in select * from private.legacy_scope_tables() loop
    v_key := v_row.schema_name||'.'||v_row.table_name;
    if (v_current->v_key->>'foreign')::bigint <> 0 then
      raise exception 'Other business is already tagged on %; no rows updated',v_key;
    end if;
  end loop;

  -- A child may already reference a parent through an M2c composite FK,
  -- even if the constraint is still NOT VALID. Parent rows MUST be tagged
  -- first: customer -> sale -> decision -> held/returns, crate -> product,
  -- product -> stock, etc. Discover ordering from existing FK metadata.
  if (select count(*)
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class child on child.oid=c.conrelid
      join pg_catalog.pg_namespace cn on cn.oid=child.relnamespace
      join private.legacy_scope_tables() s
        on s.schema_name=cn.nspname and s.table_name=child.relname
      where c.contype='f' and pg_catalog.left(c.conname,7)='tenant_'
  )<>31 then
    raise exception 'Exactly 31 tenant FK edges are required for safe backfill';
  end if;

  for v_row in
    with recursive
      allowed as (
        select x.schema_name, x.table_name,
          x.schema_name||'.'||x.table_name as key
        from private.legacy_scope_tables() x
      ),
      edges as (
        select distinct
          cn.nspname||'.'||child.relname as child_key,
          pn.nspname||'.'||parent.relname as parent_key
        from pg_catalog.pg_constraint c
        join pg_catalog.pg_class child on child.oid=c.conrelid
        join pg_catalog.pg_namespace cn on cn.oid=child.relnamespace
        join pg_catalog.pg_class parent on parent.oid=c.confrelid
        join pg_catalog.pg_namespace pn on pn.oid=parent.relnamespace
        join allowed ch on ch.key=cn.nspname||'.'||child.relname
        join allowed pa on pa.key=pn.nspname||'.'||parent.relname
        where c.contype='f' and pg_catalog.left(c.conname,7)='tenant_'
      ),
      ancestry as (
        select a.key, 0 as depth, ARRAY[a.key]::text[] as path
        from allowed a
        union all
        select e.child_key, ancestry.depth+1,
          ancestry.path||e.child_key
        from ancestry join edges e on e.parent_key=ancestry.key
        where e.child_key <> all(ancestry.path)
          and ancestry.depth<29
      ),
      priority as (
        select key,max(depth) as rank from ancestry group by key
      )
    select a.schema_name,a.table_name from allowed a
    join priority p on p.key=a.key
    order by p.rank,a.schema_name,a.table_name
  loop
    execute pg_catalog.format(
      'update %I.%I set business_id=$1 where business_id is null',
      v_row.schema_name,v_row.table_name) using v_business;
    get diagnostics v_updated = row_count;
    v_assigned := v_assigned + v_updated;
  end loop;
  v_after := private.legacy_scope_snapshot();
  for v_row in select * from private.legacy_scope_tables() loop
    v_key := v_row.schema_name||'.'||v_row.table_name;
    if (v_after->v_key->>'total')::bigint
        <> (v_current->v_key->>'total')::bigint
       or (v_after->v_key->>'unassigned')::bigint <> 0
       or (v_after->v_key->>'foreign')::bigint <> 0
       or (v_after->v_key->>'legacy')::bigint
          <> (v_after->v_key->>'total')::bigint then
      raise exception 'Post-backfill verification failed on %; transaction aborted',v_key;
    end if;
  end loop;
  return pg_catalog.jsonb_build_object(
    'legacy_business_id',v_business,'rows_assigned',v_assigned,
    'after',v_after);
end;
$$;

-- Preserve private-only administrative access.
revoke all on function private.backfill_legacy_shop_rows(jsonb)
  from public, anon, authenticated, service_role;
commit;
