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
     or position('is_shop_owner' in v_insert)>0 then
    raise exception 'Product INSERT policy is not scoped to legacy or gated owned business';
  end if;

  -- Direct table INSERT must remain unavailable. The validated SECURITY
  -- DEFINER catalogue RPC is the sole new-business product creation path.
  if has_any_column_privilege('authenticated','public.products','INSERT')
     or not has_function_privilege('authenticated',
       'public.add_business_catalogue_drink(uuid,uuid,uuid,uuid,integer,integer,integer,integer,integer,boolean,text,text)','EXECUTE')
     or has_function_privilege('anon',
       'public.add_business_catalogue_drink(uuid,uuid,uuid,uuid,integer,integer,integer,integer,integer,boolean,text,text)','EXECUTE') then
    raise exception 'Tenant product write privilege boundary failed: direct_insert=%, authenticated_rpc=%, anon_rpc=%',
      has_any_column_privilege('authenticated','public.products','INSERT'),
      has_function_privilege('authenticated',
        'public.add_business_catalogue_drink(uuid,uuid,uuid,uuid,integer,integer,integer,integer,integer,boolean,text,text)','EXECUTE'),
      has_function_privilege('anon',
        'public.add_business_catalogue_drink(uuid,uuid,uuid,uuid,integer,integer,integer,integer,integer,boolean,text,text)','EXECUTE');
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
