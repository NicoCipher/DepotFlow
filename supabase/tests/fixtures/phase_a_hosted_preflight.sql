-- READ ONLY. Run against hosted production before the Phase A approval window.
-- No user IDs, customer rows, balances or secrets are selected or printed.
-- Checks exact schema prerequisites for Phase A stages 1-5; this is NOT a
-- backup, full managed Supabase clone, or authorization to apply migrations.
WITH scoped_table(schema_name,table_name) AS (VALUES
('public','bottle_deposit_price'),('public','bottle_obligations'),
('public','crate_deposit_prices'),('public','crate_obligations'),
('public','crate_swap_rules'),('public','crate_types'),
('public','customer_opening_balances'),('public','customer_payments'),
('public','customers'),('public','deposits'),('public','empty_bottle_stock'),
('public','empty_crate_movements'),('public','empty_crate_stock'),
('public','money_owed'),('public','product_cost_history'),
('public','product_selling_price_history'),('public','products'),
('public','sale_empty_bottle_returns'),('public','sale_empty_crate_returns'),
('public','sale_empty_decisions'),('public','sale_items'),('public','sales'),
('public','shop_profile'),('public','stock'),('public','stock_movements'),
('private','confirmed_selling_prices'),('private','customer_empty_returns'),
('private','held_empty_collections'),('private','stock_receipts')
), fk AS (
  SELECT 'tenant_'||c.conname AS generated_name
    FROM pg_constraint c
    JOIN pg_class child ON child.oid=c.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid=child.relnamespace
    JOIN pg_class parent ON parent.oid=c.confrelid
    JOIN pg_attribute child_attr
      ON child_attr.attrelid=child.oid AND child_attr.attnum=c.conkey[1]
   WHERE c.contype='f'
     AND pg_catalog.array_length(c.conkey,1)=1
     AND pg_catalog.array_length(c.confkey,1)=1
     AND child_ns.nspname IN ('public','private')
     AND parent.oid IN ('public.customers'::regclass,
                        'public.crate_types'::regclass,
                        'public.products'::regclass,
                        'public.sales'::regclass,
                        'public.sale_empty_decisions'::regclass)
     AND EXISTS(SELECT 1 FROM scoped_table s
                WHERE s.schema_name=child_ns.nspname
                  AND s.table_name=child.relname)
     AND child_attr.attname <> 'business_id'
), values_ AS (
  SELECT (SELECT count(*) FROM private.shop_owner) AS owner_count,
         (SELECT count(*) FROM private.shop_owner o
             JOIN auth.users u ON u.id=o.user_id) AS verified_owner_count,
         (SELECT count(*) FROM pg_class c
             JOIN pg_namespace n ON n.oid=c.relnamespace
             JOIN scoped_table t ON t.schema_name=n.nspname
               AND t.table_name=c.relname WHERE c.relkind IN ('r','p')) AS scope_count,
         (SELECT count(*) FROM information_schema.columns c
             JOIN scoped_table t ON t.schema_name=c.table_schema
               AND t.table_name=c.table_name
             WHERE c.column_name='business_id') AS preexisting_business_tags,
         (SELECT count(*) FROM information_schema.columns
             WHERE table_schema='public' AND table_name='product_catalogue'
               AND column_name='business_id') AS global_catalogue_tags,
         (SELECT count(*) FROM fk) AS scope_fk_count,
         (SELECT count(*) FROM fk
             WHERE length(generated_name)>63) AS overlong_fk_count,
         (SELECT to_regclass('private.businesses') IS NOT NULL) AS tenant_tables_already_present,
         (SELECT enabled IS FALSE FROM private.business_auth_signup_gate
             WHERE singleton IS TRUE) AS signup_gate_closed,
         (SELECT count(*) FROM supabase_migrations.schema_migrations) AS existing_migrations,
         (SELECT max(version) FROM supabase_migrations.schema_migrations) AS migration_tip,
         (SELECT count(*) FROM auth.users) AS auth_accounts,
         (SELECT exists (SELECT 1 FROM pg_trigger
             WHERE tgrelid='auth.users'::regclass
               AND tgname='depotflow_auth_user_insert_guard'
               AND tgenabled IN ('O','A'))) AS auth_guard_active
)
SELECT jsonb_build_object(
 'checks',jsonb_build_object(
   'legacy_owner_count',owner_count,
   'verified_owner_count',verified_owner_count,
   'business_table_count',scope_count,
   'expected_business_tables',29,
   'already_tagged_business_tables',preexisting_business_tags,
   'global_catalogue_business_tags',global_catalogue_tags,
   'existing_fk_relationships',scope_fk_count,
   'overlong_future_fk_names',overlong_fk_count,
   'tenant_tables_already_present',tenant_tables_already_present,
   'signup_gate_closed',signup_gate_closed,
   'auth_guard_active',auth_guard_active,
   'existing_migrations',existing_migrations,
   'migration_tip',migration_tip,
   'auth_accounts',auth_accounts
 ),
 'preconditions_pass',
  owner_count=1 AND verified_owner_count=1 AND scope_count=29
  AND preexisting_business_tags=0 AND global_catalogue_tags=0
  AND scope_fk_count=31 AND overlong_fk_count=0
  AND NOT tenant_tables_already_present AND signup_gate_closed IS TRUE
  AND auth_guard_active AND existing_migrations=56
  AND migration_tip='20261019132131' AND auth_accounts=1,
 'warning','PRECONDITIONS ONLY: still require exact migration name/order parity, secure validated backup, tenant data invariants, managed-platform proof and separate owner approval'
)::text AS phase_a_preflight
FROM values_;
