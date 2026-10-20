-- SELECT-only: compare a synthetic original-shop ledger/stock fingerprint
-- before and after draft multi-tenant migrations. Intentionally select only
-- V1 columns, excluding newly added business_id so additive tags don't
-- invalidate the preservation check. Do not run against customer production.
select md5(jsonb_build_object(
 'owner',(select jsonb_agg(jsonb_build_array(id,email_confirmed_at) order by id)
   from auth.users where id='9a770000-0000-4000-8000-000000000001'),
 'shop',(select jsonb_agg(jsonb_build_array(id,name,address,phone,logo_url))
   from public.shop_profile where name='Synthetic Legacy Shop'),
 'crates',(select jsonb_agg(jsonb_build_array(id,name,empty_family,pocket_count,variant) order by id)
   from public.crate_types where id='9a770000-0000-4000-9000-000000000010'),
 'products',(select jsonb_agg(jsonb_build_array(id,name,full_crate_price,bottle_price,
   bottles_returnable,empty_family,crate_type,bottle_type,crate_type_id) order by id)
   from public.products where id='9a770000-0000-4000-9000-000000000011'),
 'stock',(select jsonb_agg(jsonb_build_array(product_id,total_bottles) order by product_id)
   from public.stock where product_id='9a770000-0000-4000-9000-000000000011'),
 'customer',(select jsonb_agg(jsonb_build_array(id,name,phone,archived_at) order by id)
   from public.customers where id='9a770000-0000-4000-9000-000000000012'),
 'owed',(select jsonb_agg(jsonb_build_array(customer_id,amount) order by customer_id)
   from public.money_owed where customer_id='9a770000-0000-4000-9000-000000000012'),
 'empty_crates',(select jsonb_agg(jsonb_build_array(crate_type_id,crate_type,quantity) order by crate_type_id)
   from public.empty_crate_stock where crate_type_id='9a770000-0000-4000-9000-000000000010'),
 'empty_bottles',(select jsonb_agg(jsonb_build_array(bottle_type,quantity) order by bottle_type)
   from public.empty_bottle_stock where bottle_type='Synthetic Legacy Bottle'),
 'crate_obligations',(select jsonb_agg(jsonb_build_array(customer_id,crate_type_id,quantity) order by crate_type_id)
   from public.crate_obligations where customer_id='9a770000-0000-4000-9000-000000000012'),
 'bottle_obligations',(select jsonb_agg(jsonb_build_array(customer_id,bottle_type,quantity) order by bottle_type)
   from public.bottle_obligations where customer_id='9a770000-0000-4000-9000-000000000012'),
 'sales',(select jsonb_agg(jsonb_build_array(id,customer_id,total_amount,paid_amount,
   business_date,payment_method,receipt_number,receipt_business,receipt_customer_name,
   receipt_customer_name_source) order by id)
   from public.sales where id='9a770000-0000-4000-9000-000000000013'),
 'sale_items',(select jsonb_agg(jsonb_build_array(id,sale_id,product_id,
   product_name,total_bottles,bottles_per_crate,line_total,
   bottles_returnable,crate_type_id,whole_crates,crates_out,
   crates_returned,bottles_returned) order by id)
   from public.sale_items where id='9a770000-0000-4000-9000-000000000014'),
 'stock_movements',(select jsonb_agg(jsonb_build_array(id,product_id,movement_type,
   quantity_change,resulting_stock,business_date,request_id,crates,
   loose_bottles,bottles_per_crate,product_name,crate_type_id) order by id)
   from public.stock_movements where id='9a770000-0000-4000-9000-000000000015')
)::text) as synthetic_legacy_ledger_sha;
