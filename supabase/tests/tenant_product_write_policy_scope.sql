-- Regression guard for tenant-scoped product writes.
-- This test checks the deployed policy definitions in the disposable PG17
-- integration database. It does not mutate production or open any rollout gate.
begin;

do $product_write_policy$
declare
  v_insert text;
  v_update_using text;
  v_update_check text;
begin
  select with_check into v_insert
  from pg_policies
  where schemaname='public' and tablename='products'
    and policyname='owner_insert_product' and cmd='INSERT';

  select qual, with_check into v_update_using, v_update_check
  from pg_policies
  where schemaname='public' and tablename='products'
    and policyname='owner_update_product' and cmd='UPDATE';

  if v_insert is null
     or position('can_read_legacy_customer' in v_insert)=0
     or position('can_insert_tenant_product' in v_insert)=0
     or position('is_shop_owner' in v_insert)>0 then
    raise exception 'Product INSERT policy is not scoped to legacy or gated owned business';
  end if;

  -- A guarded tenant INSERT must be callable, but caller-chosen global IDs
  -- must remain unavailable. This catches the previous state where the RLS
  -- helper existed but no authenticated insert grant could reach it.
  if not has_column_privilege('authenticated','public.products','business_id','INSERT')
     or not has_column_privilege('authenticated','public.products','name','INSERT')
     or has_column_privilege('authenticated','public.products','id','INSERT') then
    raise exception 'Tenant product INSERT grants must include business_id and omit caller-supplied id';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='can_insert_tenant_product'
      and p.prosecdef is true
      and pg_get_functiondef(p.oid) like '%legacy_write_scope_gate%'
      and pg_get_functiondef(p.oid) like '%business_assortment_setup_gate%'
      and pg_get_functiondef(p.oid) like '%owns_new_business%'
  ) then
    raise exception 'Tenant product insert helper must privately check both rollout gates and ownership';
  end if;

  if v_update_using is null
     or v_update_check is null
     or position('can_read_legacy_customer' in v_update_using)=0
     or position('can_read_legacy_customer' in v_update_check)=0
     or position('is_shop_owner' in v_update_using)>0
     or position('is_shop_owner' in v_update_check)>0
     or position('owns_new_business' in v_update_check)>0 then
    raise exception 'Product UPDATE policy must preserve legacy scope and deny unreviewed tenant updates';
  end if;
end;
$product_write_policy$;

rollback;
