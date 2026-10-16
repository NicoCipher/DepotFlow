-- M2c (part 1): protect relationships between already-tagged business rows.
-- NOT a replacement for tenant RLS, tenant-aware RPCs, or NOT NULL business_id.
-- A NULL business_id still bypasses a composite FK (MATCH SIMPLE), by design
-- until legacy writes are migrated and the 29-table tenant completeness gate passes.
--
-- Dependency: M1 / M1b / M2a / M2b; no signup or second shop access at this stage.
-- Never run directly against production without migration backup and lock review.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Globally unique UUID primary keys are kept for backwards compatibility.
-- These additional unique pairs permit composite FKs that prove the referenced
-- row belongs to the SAME business, rather than checking only its global UUID.
alter table public.customers
  add constraint customers_business_id_id_unique unique (business_id,id);
alter table public.crate_types
  add constraint crate_types_business_id_id_unique unique (business_id,id);
alter table public.products
  add constraint products_business_id_id_unique unique (business_id,id);
alter table public.sales
  add constraint sales_business_id_id_unique unique (business_id,id);
alter table public.sale_empty_decisions
  add constraint sale_empty_decisions_business_id_id_unique unique (business_id,id);

-- The 31 existing local foreign keys identify authoritative relationships,
-- including private held collections and stock receipts. Add a business-aware
-- counterpart for each; keep every original single-column FK intact.
--
-- Excluded deliberately:
--   auth.users (individual identity is global, not shop-owned)
--   public.product_catalogue (shared master catalogue)
--   private.businesses (the standalone business_id identity FKs from M2a)
--
-- No policy/grant/RPC changes. NOT VALID avoids scanning existing historical
-- rows until they have been backfilled and checked. New non-NULL tagged writes
-- are enforced immediately; a separate release gate must VALIDATE all 31 FKs.
do $m2c$
declare
  r record;
  v_total integer:=0;
  v_constraint text;
begin
  for r in
    select
      child_ns.nspname as child_schema,
      child.relname as child_table,
      child_attr.attname as child_column,
      parent_ns.nspname as parent_schema,
      parent.relname as parent_table,
      parent_attr.attname as parent_column,
      con.conname as source_constraint
    from pg_constraint con
    join pg_class child on child.oid=con.conrelid
    join pg_namespace child_ns on child_ns.oid=child.relnamespace
    join pg_class parent on parent.oid=con.confrelid
    join pg_namespace parent_ns on parent_ns.oid=parent.relnamespace
    join pg_attribute child_attr
      on child_attr.attrelid=child.oid and child_attr.attnum=con.conkey[1]
    join pg_attribute parent_attr
      on parent_attr.attrelid=parent.oid and parent_attr.attnum=con.confkey[1]
    where con.contype='f'
      and pg_catalog.array_length(con.conkey,1)=1
      and pg_catalog.array_length(con.confkey,1)=1
      and child_ns.nspname in ('public','private')
      and parent.oid in (
        'public.customers'::regclass,
        'public.crate_types'::regclass,
        'public.products'::regclass,
        'public.sales'::regclass,
        'public.sale_empty_decisions'::regclass
      )
      and exists (
        select 1 from private.legacy_scope_tables() as allowlist
        where allowlist.schema_name=child_ns.nspname
          and allowlist.table_name=child.relname
      )
      and child_attr.attname <> 'business_id'
    order by child_ns.nspname,child.relname,con.conname
  loop
    v_constraint := 'tenant_'||r.source_constraint;
    if length(v_constraint)>63 then
      raise exception 'Tenant constraint identifier would truncate: %',v_constraint;
    end if;
    execute pg_catalog.format(
      'alter table %I.%I add constraint %I
        foreign key (business_id,%I)
        references %I.%I(business_id,%I) not valid',
      r.child_schema,r.child_table,v_constraint,r.child_column,
      r.parent_schema,r.parent_table,r.parent_column
    );
    v_total:=v_total+1;
  end loop;
  if v_total<>31 then
    raise exception 'Expected 31 existing shop-owned FK relationships, got %',v_total;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='product_catalogue'
      and column_name='business_id'
  ) then
    raise exception 'The global master catalogue was mistakenly tenant scoped';
  end if;
end;
$m2c$;
commit;
