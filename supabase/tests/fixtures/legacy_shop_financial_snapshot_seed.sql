-- Disposable-only original single-shop data, inserted AFTER the 55
-- recorded production SQL stages and BEFORE the 66 draft multi-business
-- migration stages. These deliberately use fixed synthetic UUIDs; no real
-- customer accounts, business names, credentials or financial data.
begin;
insert into auth.users(id,email_confirmed_at)
 values('9a770000-0000-4000-8000-000000000001',now());
insert into private.shop_owner(user_id)
 values('9a770000-0000-4000-8000-000000000001');
insert into public.shop_profile(id,name,address,phone,logo_url)
 values(true,'Synthetic Legacy Shop','Test address','08000000000','');
insert into public.crate_types(id,name,empty_family,pocket_count,variant)
 values('9a770000-0000-4000-9000-000000000010',
        'Synthetic 24 Bottle Crate','NBL',24,null);
insert into public.products(
 id,name,size,bottles_per_crate,full_crate_price,
 bottle_price,bottles_returnable,empty_family,crate_type,
 bottle_type,crate_type_id
) values(
 '9a770000-0000-4000-9000-000000000011',
 'Synthetic Legacy Drink','60cl',24,12000,
 500,true,'NBL','Synthetic 24 Bottle Crate',
 'Synthetic Legacy Bottle','9a770000-0000-4000-9000-000000000010'
);
insert into public.stock(product_id,total_bottles)
 values('9a770000-0000-4000-9000-000000000011',120);
insert into public.customers(id,name,phone)
 values('9a770000-0000-4000-9000-000000000012',
 'Synthetic Existing Customer','08000000001');
insert into public.money_owed(customer_id,amount)
 values('9a770000-0000-4000-9000-000000000012',1400);
insert into public.empty_crate_stock(crate_type,crate_type_id,quantity)
 values('Synthetic 24 Bottle Crate','9a770000-0000-4000-9000-000000000010',8);
insert into public.empty_bottle_stock(bottle_type,quantity)
 values('Synthetic Legacy Bottle',19);
insert into public.crate_obligations(customer_id,crate_type,crate_type_id,quantity)
 values('9a770000-0000-4000-9000-000000000012',
 'Synthetic 24 Bottle Crate','9a770000-0000-4000-9000-000000000010',3);
insert into public.bottle_obligations(customer_id,bottle_type,quantity)
 values('9a770000-0000-4000-9000-000000000012',
 'Synthetic Legacy Bottle',17);
insert into public.sales(
 id,customer_id,total_amount,paid_amount,business_date,payment_method,
 receipt_business,receipt_customer_name,receipt_customer_name_source
) values(
 '9a770000-0000-4000-9000-000000000013',
 '9a770000-0000-4000-9000-000000000012',12000,10000,
 '2026-10-01','cash','{"name":"Synthetic Legacy Shop"}',
 'Synthetic Existing Customer','captured'
);
insert into public.sale_items(
 id,sale_id,product_id,product_name,total_bottles,bottles_per_crate,
 line_total,bottles_returnable,bottle_type,crate_type,crate_type_id,
 whole_crates,crates_out,returnable_bottles_out,crates_returned,bottles_returned
) values(
 '9a770000-0000-4000-9000-000000000014',
 '9a770000-0000-4000-9000-000000000013',
 '9a770000-0000-4000-9000-000000000011',
 'Synthetic Legacy Drink',24,24,12000,true,'Synthetic Legacy Bottle',
 'Synthetic 24 Bottle Crate','9a770000-0000-4000-9000-000000000010',
 1,1,24,0,0
);
insert into public.stock_movements(
 id,product_id,movement_type,quantity_change,resulting_stock,
 business_date,request_id,crates,loose_bottles,bottles_per_crate,
 product_name,crate_type_id
) values(
 '9a770000-0000-4000-9000-000000000015',
 '9a770000-0000-4000-9000-000000000011',
 'count',120,120,'2026-10-01',
 '9a770000-0000-4000-9000-000000000016',
 5,0,24,'Synthetic Legacy Drink',
 '9a770000-0000-4000-9000-000000000010'
);
commit;
