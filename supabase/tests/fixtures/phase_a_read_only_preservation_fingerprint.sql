-- SELECT ONLY, for operator-controlled pre/post Phase A snapshot.
-- Returns aggregate row counts and hashes ONLY, no customer names, contacts,
-- receipt tokens, UUIDs, passwords or business-record rows.
-- Store live output privately; NEVER commit output to the public repository.
-- Compare snapshots only in a QUIET deployment window without concurrent sales.
WITH fingerprints AS (
 SELECT 'public.customers' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.id,t.name,t.phone,t.business_name,t.address,t.archived_at,t.empties_deposit_required)::text,E'\\n' ORDER BY t.id),'')) AS digest
 FROM public.customers AS t
 UNION ALL
 SELECT 'public.products' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.id,t.name,t.size,t.crate_type_id,t.full_crate_price,t.bottles_per_crate,t.is_active)::text,E'\\n' ORDER BY t.id),'')) AS digest
 FROM public.products AS t
 UNION ALL
 SELECT 'public.crate_types' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.id,t.name,t.empty_family,t.pocket_count,t.variant,t.is_legacy)::text,E'\\n' ORDER BY t.id),'')) AS digest
 FROM public.crate_types AS t
 UNION ALL
 SELECT 'public.sales' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.id,t.customer_id,t.total_amount,t.paid_amount,t.business_date,t.request_id,t.receipt_number,t.receipt_status)::text,E'\\n' ORDER BY t.id),'')) AS digest
 FROM public.sales AS t
 UNION ALL
 SELECT 'public.sale_items' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.id,t.sale_id,t.product_id,t.total_bottles,t.line_total,t.crate_type_id,t.crates_out)::text,E'\\n' ORDER BY t.id),'')) AS digest
 FROM public.sale_items AS t
 UNION ALL
 SELECT 'public.customer_payments' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.id,t.customer_id,t.amount,t.owed_after,t.business_date,t.request_id,t.receipt_number,t.method)::text,E'\\n' ORDER BY t.id),'')) AS digest
 FROM public.customer_payments AS t
 UNION ALL
 SELECT 'public.money_owed' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.customer_id,t.amount)::text,E'\\n' ORDER BY t.customer_id),'')) AS digest
 FROM public.money_owed AS t
 UNION ALL
 SELECT 'public.deposits' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.customer_id,t.amount)::text,E'\\n' ORDER BY t.customer_id),'')) AS digest
 FROM public.deposits AS t
 UNION ALL
 SELECT 'public.stock' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.product_id,t.total_bottles)::text,E'\\n' ORDER BY t.product_id),'')) AS digest
 FROM public.stock AS t
 UNION ALL
 SELECT 'public.empty_crate_stock' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.crate_type,t.quantity,t.crate_type_id)::text,E'\\n' ORDER BY t.crate_type),'')) AS digest
 FROM public.empty_crate_stock AS t
 UNION ALL
 SELECT 'public.empty_bottle_stock' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.bottle_type,t.quantity)::text,E'\\n' ORDER BY t.bottle_type),'')) AS digest
 FROM public.empty_bottle_stock AS t
 UNION ALL
 SELECT 'public.crate_obligations' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.customer_id,t.crate_type,t.crate_type_id,t.quantity)::text,E'\\n' ORDER BY t.customer_id,t.crate_type),'')) AS digest
 FROM public.crate_obligations AS t
 UNION ALL
 SELECT 'public.bottle_obligations' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.customer_id,t.bottle_type,t.quantity)::text,E'\\n' ORDER BY t.customer_id,t.bottle_type),'')) AS digest
 FROM public.bottle_obligations AS t
 UNION ALL
 SELECT 'public.sale_tender_legs' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.sale_id,t.method,t.sale_amount,t.old_debt_amount,t.old_debt_payment_id)::text,E'\\n' ORDER BY t.sale_id,t.method),'')) AS digest
 FROM public.sale_tender_legs AS t
 UNION ALL
 SELECT 'public.stock_movements' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.id,t.product_id,t.quantity_change,t.resulting_stock,t.request_id,t.sale_id)::text,E'\\n' ORDER BY t.id),'')) AS digest
 FROM public.stock_movements AS t
 UNION ALL
 SELECT 'public.customer_opening_balances' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.id,t.customer_id,t.amount,t.business_date,t.request_id)::text,E'\\n' ORDER BY t.id),'')) AS digest
 FROM public.customer_opening_balances AS t
 UNION ALL
 SELECT 'private.shop_owner' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.singleton,t.user_id)::text,E'\\n' ORDER BY t.singleton),'')) AS digest
 FROM private.shop_owner AS t
 UNION ALL
 SELECT 'private.customer_empty_returns' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.request_id,t.customer_id,t.request_payload)::text,E'\\n' ORDER BY t.request_id),'')) AS digest
 FROM private.customer_empty_returns AS t
 UNION ALL
 SELECT 'private.held_empty_collections' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.decision_id,t.customer_id)::text,E'\\n' ORDER BY t.decision_id),'')) AS digest
 FROM private.held_empty_collections AS t
 UNION ALL
 SELECT 'private.stock_receipts' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.request_id,t.product_id,t.crates,t.stock_after,t.empties_after,t.crate_type_id)::text,E'\\n' ORDER BY t.request_id,t.product_id),'')) AS digest
 FROM private.stock_receipts AS t
 UNION ALL
 SELECT 'public.shop_profile' AS entity, count(*)::bigint AS rows,
   md5(coalesce(string_agg(jsonb_build_array(t.id,t.name,t.address,t.phone)::text,E'\\n' ORDER BY t.id),'')) AS digest
 FROM public.shop_profile AS t
)
SELECT jsonb_build_object(
 'snapshot_type','DepotFlow prepost Phase A protected aggregate preservation V1',
 'fingerprints', (SELECT jsonb_object_agg(entity,jsonb_build_object('rows',rows,'digest',digest)) FROM fingerprints),
 'auth_user_count',(SELECT count(*) FROM auth.users),
 'signup_gate_off',(SELECT enabled IS FALSE FROM private.business_auth_signup_gate WHERE singleton),
 'missing_customer_sales',(SELECT count(*) FROM public.sales s LEFT JOIN public.customers c ON c.id=s.customer_id WHERE c.id IS NULL),
 'missing_customer_payments',(SELECT count(*) FROM public.customer_payments p LEFT JOIN public.customers c ON c.id=p.customer_id WHERE c.id IS NULL),
 'orphan_sale_items',(SELECT count(*) FROM public.sale_items i LEFT JOIN public.sales s ON i.sale_id=s.id WHERE s.id IS NULL),
 'orphan_sale_tenders',(SELECT count(*) FROM public.sale_tender_legs t LEFT JOIN public.sales s ON t.sale_id=s.id WHERE s.id IS NULL),
 'orphan_stock',(SELECT count(*) FROM public.stock s LEFT JOIN public.products p ON s.product_id=p.id WHERE p.id IS NULL)
)::text AS preservation_fingerprint;
