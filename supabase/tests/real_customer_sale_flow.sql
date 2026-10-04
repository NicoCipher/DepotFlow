-- Real shop examples. All data stays in the disposable test transaction.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000001001'),('00000000-0000-4000-8000-000000001002');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000001001');
insert into public.crate_types(id,name,empty_family,pocket_count) values
 ('50000000-0000-4000-8000-000000001001','NB Test','NB',12),
 ('50000000-0000-4000-8000-000000001002','Trophy Test','Trophy',12),
 ('50000000-0000-4000-8000-000000001003','24 Test','Other',24);
insert into public.products(id,name,bottles_per_crate,full_crate_price,bottle_price,bottles_returnable,bottle_type,crate_type_id) values
 ('10000000-0000-4000-8000-000000001001','Goldberg Test',12,12000,1000,true,'NB Test bottle','50000000-0000-4000-8000-000000001001'),
 ('10000000-0000-4000-8000-000000001002','Trophy Test',12,12000,1000,true,'Trophy Test bottle','50000000-0000-4000-8000-000000001002'),
 ('10000000-0000-4000-8000-000000001003','24 Test',24,24000,null,false,null,'50000000-0000-4000-8000-000000001003');
insert into public.stock(product_id,total_bottles) select id,240 from public.products where name in ('Goldberg Test','Trophy Test','24 Test');
insert into public.customers(id,name,phone) values ('20000000-0000-4000-8000-000000001001','Real shop test','08000001001');
create function pg_temp.line(p_id uuid,p_crates int,p_eighths int,p_return_crates int,p_return_bottles int,p_choices jsonb default '[]') returns jsonb language sql as $$
 select jsonb_build_object('productId',id,'quantity',jsonb_build_object('crates',p_crates,'fraction',0,'eighths',p_eighths,'bottles',0),'cratesTaken',p_crates,'returnedCrates',p_return_crates,'returnedBottles',p_return_bottles,'emptyDecisions',p_choices,'expected',jsonb_build_object('full',full_crate_price,'half',half_crate_price,'quarter',quarter_crate_price,'bottle',bottle_price,'size',bottles_per_crate,'crate',crate_type_id,'returnable',bottles_returnable,'bottleType',bottle_type)) from public.products where id=p_id;
$$;
create function pg_temp.ok(v boolean,m text) returns void language plpgsql as $$begin if v is distinct from true then raise exception '%',m; end if; end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001001',true);
select public.save_business_details('My drinks shop','Lagos','08012345678','');
do $$declare result jsonb; sid uuid; lines jsonb; choice jsonb; held_id uuid; before_stock int;
begin
 choice:='{"productId":"10000000-0000-4000-8000-000000001001","kind":"crate","returnedType":"50000000-0000-4000-8000-000000001002","quantity":"1","decision":"hold"}';
 lines:=jsonb_build_array(pg_temp.line('10000000-0000-4000-8000-000000001001',1,0,0,12,jsonb_build_array(choice)),pg_temp.line('10000000-0000-4000-8000-000000001002',1,0,1,12));
 result:=public.save_sale_v2('40000000-0000-4000-8000-000000001001','20000000-0000-4000-8000-000000001001','2026-10-01',20000,lines,'[{"crateTypeId":"50000000-0000-4000-8000-000000001002","quantity":2}]','[{"bottleType":"NB Test bottle","quantity":12},{"bottleType":"Trophy Test bottle","quantity":12}]','cash');
 sid:=(result->>'id')::uuid;
 perform pg_temp.ok((result->>'total')::int=24000 and (result->>'owing')::int=4000,'Sale money incorrect');
 perform pg_temp.ok((select quantity=1 from public.crate_obligations where customer_id='20000000-0000-4000-8000-000000001001' and crate_type_id='50000000-0000-4000-8000-000000001001'),'Held crate settled debt');
 perform pg_temp.ok(not exists(select 1 from public.bottle_obligations where customer_id='20000000-0000-4000-8000-000000001001' and quantity>0),'Correct bottles did not settle separately');
 perform pg_temp.ok((select quantity=1 from public.empty_crate_stock where crate_type_id='50000000-0000-4000-8000-000000001002'),'Held property entered usable stock');
 perform pg_temp.ok((select receipt_business->>'name'='My drinks shop' from public.sales where id=sid),'Receipt shop snapshot missing');
 perform pg_temp.ok((select count(*)=2 from public.sale_items where sale_id=sid),'Receipt line facts missing');
 perform pg_temp.ok((select public.verify_receipt(verification_token)->>'customer'='Real shop test' from public.sales where id=sid),'Public sale receipt customer missing');
 perform pg_temp.ok((select public.verify_receipt(verification_token)->>'customer_snapshot_source'='captured' from public.sales where id=sid),'Sale customer snapshot was not captured at save');
 update public.customers set name='Real shop renamed' where id='20000000-0000-4000-8000-000000001001';
 perform pg_temp.ok((select public.verify_receipt(verification_token)->>'customer'='Real shop test' from public.sales where id=sid),'Customer edit rewrote historical sale receipt');
 update public.customers set name='Real shop test' where id='20000000-0000-4000-8000-000000001001';
 perform pg_temp.ok((select public.verify_receipt(verification_token)->'business'->>'name'='My drinks shop' from public.sales where id=sid),'Public sale receipt business missing');
 perform pg_temp.ok((select (public.verify_receipt(verification_token)->>'total')::int=24000 and (public.verify_receipt(verification_token)->>'balance')::int=4000 from public.sales where id=sid),'Public sale receipt totals missing');
 perform pg_temp.ok((select public.verify_receipt(verification_token)->>'method'='cash' from public.sales where id=sid),'Public sale receipt method missing');
 perform pg_temp.ok((select jsonb_array_length(public.verify_receipt(verification_token)->'items')=2 from public.sales where id=sid),'Public sale receipt items missing');
 perform pg_temp.ok((select public.verify_receipt(verification_token) ? 'customer_id' = false from public.sales where id=sid),'Public sale receipt leaked customer ID');
 perform public.save_sale_v2('40000000-0000-4000-8000-000000001001','20000000-0000-4000-8000-000000001001','2026-10-01',20000,lines,'[{"crateTypeId":"50000000-0000-4000-8000-000000001002","quantity":2}]','[{"bottleType":"NB Test bottle","quantity":12},{"bottleType":"Trophy Test bottle","quantity":12}]','cash');
 perform pg_temp.ok((select count(*)=1 from public.sale_empty_decisions where sale_id=sid),'Retry duplicated held property');
 select id into held_id from public.sale_empty_decisions where sale_id=sid;
 perform public.release_held_empties(held_id);
 perform public.release_held_empties(held_id);
 perform pg_temp.ok((select released_at is not null from public.sale_empty_decisions where id=held_id),'Held collection was not recorded');
 perform pg_temp.ok((select quantity=1 from public.empty_crate_stock where crate_type_id='50000000-0000-4000-8000-000000001002'),'Held collection changed usable stock');
 perform pg_temp.ok((select quantity=1 from public.crate_obligations where customer_id='20000000-0000-4000-8000-000000001001' and crate_type_id='50000000-0000-4000-8000-000000001001'),'Held collection settled debt');
 perform public.save_business_details('Updated shop','Abuja','','');
 perform pg_temp.ok((select receipt_business->>'name'='My drinks shop' from public.sales where id=sid),'Later settings rewrote historical receipt');
 -- Accept wrong crates and bottles independently for this sale only.
 choice:='[{"productId":"10000000-0000-4000-8000-000000001001","kind":"crate","returnedType":"50000000-0000-4000-8000-000000001002","quantity":"1","decision":"accept"},{"productId":"10000000-0000-4000-8000-000000001001","kind":"bottle","returnedType":"Trophy Test bottle","quantity":"12","decision":"accept"}]';
 lines:=jsonb_build_array(pg_temp.line('10000000-0000-4000-8000-000000001001',1,0,1,12,choice));
 result:=public.save_sale_v2('40000000-0000-4000-8000-000000001002','20000000-0000-4000-8000-000000001001','2026-10-01',12000,lines,'[{"crateTypeId":"50000000-0000-4000-8000-000000001002","quantity":1}]','[{"bottleType":"Trophy Test bottle","quantity":12}]','transfer');
 perform pg_temp.ok((select quantity=1 from public.crate_obligations where customer_id='20000000-0000-4000-8000-000000001001' and crate_type_id='50000000-0000-4000-8000-000000001001'),'Accepted substitute added debt');
 begin
  perform public.save_sale_v2(gen_random_uuid(),'20000000-0000-4000-8000-000000001001','2026-10-01',12000,jsonb_build_array(pg_temp.line('10000000-0000-4000-8000-000000001001',1,0,0,12)),'[{"crateTypeId":"50000000-0000-4000-8000-000000001002","quantity":1}]','[{"bottleType":"NB Test bottle","quantity":12}]','cash');
  raise exception 'Undecided wrong empties entered stock';
 exception when invalid_parameter_value then null; end;
 -- A forged settlement without exact types or an explicit owner choice is rejected atomically.
 select total_bottles into before_stock from public.stock where product_id='10000000-0000-4000-8000-000000001001';
 begin
  perform public.save_sale_v2('40000000-0000-4000-8000-000000001009','20000000-0000-4000-8000-000000001001','2026-10-01',12000,jsonb_build_array(pg_temp.line('10000000-0000-4000-8000-000000001001',1,0,1,12)),'[{"crateTypeId":"50000000-0000-4000-8000-000000001002","quantity":1}]','[{"bottleType":"Trophy Test bottle","quantity":12}]','cash');
  raise exception 'Forged type settlement accepted';
 exception when invalid_parameter_value then null; end;
 perform pg_temp.ok((select total_bottles=before_stock from public.stock where product_id='10000000-0000-4000-8000-000000001001'),'Rejected choices changed stock');
end$;
reset role;
update public.sales set receipt_business=null where request_id='40000000-0000-4000-8000-000000001001';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001001',true);
select pg_temp.ok((select public.verify_receipt(verification_token)->>'business_snapshot'='false' and public.verify_receipt(verification_token)->'business'='{}'::jsonb from public.sales where request_id='40000000-0000-4000-8000-000000001001'),'Legacy sale receipt used current shop details');
-- 3 and 9 bottles use full-crate proportions even with no bottle price.
do $$declare result jsonb; q int; sid uuid;
begin
 foreach q in array array[1,3,5,7] loop
  result:=public.save_sale_v2(gen_random_uuid(),'20000000-0000-4000-8000-000000001001','2026-10-01',q*3000,jsonb_build_array(pg_temp.line('10000000-0000-4000-8000-000000001003',0,q,0,0)),'[]','[]','cash');
  sid:=(result->>'id')::uuid;
  perform pg_temp.ok((select total_bottles=q*3 and line_total=q*3000 from public.sale_items where sale_id=sid),'24-bottle quantity/price incorrect');
 end loop;
 update public.products set full_crate_price=10050 where id='10000000-0000-4000-8000-000000001003';
 foreach q in array array[1,3,5,7] loop
  result:=public.save_sale_v2(gen_random_uuid(),'20000000-0000-4000-8000-000000001001','2026-10-01',ceil(10050::numeric*q/8/50)*50,jsonb_build_array(pg_temp.line('10000000-0000-4000-8000-000000001003',0,q,0,0)),'[]','[]','cash');
  sid:=(result->>'id')::uuid;
  perform pg_temp.ok((result->>'total')::int=ceil(10050::numeric*q/8/50)*50,'Partial rounding incorrect');
  perform pg_temp.ok((select line_total=(result->>'total')::int and total_bottles=q*3 from public.sale_items where sale_id=sid),'Stored partial total incorrect');
 end loop;
 -- Round a combined half and quarter once, preserving configured overrides.
 update public.products set full_crate_price=10050,half_crate_price=null,quarter_crate_price=null where id='10000000-0000-4000-8000-000000001003';
 result:=public.save_sale_v2(gen_random_uuid(),'20000000-0000-4000-8000-000000001001','2026-10-01',7550,
   jsonb_build_array(jsonb_set(jsonb_set(pg_temp.line('10000000-0000-4000-8000-000000001003',0,0,0,0),'{quantity,fraction}','3'),'{quantity,eighths}','0')),'[]','[]','cash');
 perform pg_temp.ok((result->>'total')::int=7550,'Partial quantity was rounded more than once');

end$$;
-- Permanent complete-package rules continue to work without per-sale choices.
select public.set_crate_swap_rules('50000000-0000-4000-8000-000000001001',array['50000000-0000-4000-8000-000000001002'::uuid]);
do $$declare result jsonb;
begin
 result:=public.save_sale_v2(gen_random_uuid(),'20000000-0000-4000-8000-000000001001','2026-10-01',12000,jsonb_build_array(pg_temp.line('10000000-0000-4000-8000-000000001001',1,0,1,12)),'[{"crateTypeId":"50000000-0000-4000-8000-000000001002","quantity":1}]','[{"bottleType":"Trophy Test bottle","quantity":12}]','cash');
 perform pg_temp.ok((select quantity=1 from public.crate_obligations where customer_id='20000000-0000-4000-8000-000000001001' and crate_type_id='50000000-0000-4000-8000-000000001001'),'Permanent complete swap stopped working');
end$$;
-- The customer later brings the exact NB crates and collects held Trophy property.
do $$declare result jsonb; held_id uuid; lines jsonb;
begin
 lines:=jsonb_build_array(pg_temp.line('10000000-0000-4000-8000-000000001001',1,0,0,12,'[{"productId":"10000000-0000-4000-8000-000000001001","kind":"crate","returnedType":"50000000-0000-4000-8000-000000001002","quantity":"1","decision":"hold"}]'));
 result:=public.save_sale_v2(gen_random_uuid(),'20000000-0000-4000-8000-000000001001','2026-10-01',12000,lines,'[{"crateTypeId":"50000000-0000-4000-8000-000000001002","quantity":1}]','[{"bottleType":"NB Test bottle","quantity":12}]','cash');
 select id into held_id from public.sale_empty_decisions where sale_id=(result->>'id')::uuid;
 perform public.record_customer_empty_return('40000000-0000-4000-8000-000000001020','20000000-0000-4000-8000-000000001001','[{"crateTypeId":"50000000-0000-4000-8000-000000001001","quantity":2}]','[]',array[held_id]);
 perform public.record_customer_empty_return('40000000-0000-4000-8000-000000001020','20000000-0000-4000-8000-000000001001','[{"crateTypeId":"50000000-0000-4000-8000-000000001001","quantity":2}]','[]',array[held_id]);
 perform pg_temp.ok((select quantity=0 from public.crate_obligations where customer_id='20000000-0000-4000-8000-000000001001' and crate_type_id='50000000-0000-4000-8000-000000001001'),'Later correct return did not clear debt');
 perform pg_temp.ok((select quantity=2 from public.empty_crate_stock where crate_type_id='50000000-0000-4000-8000-000000001001'),'Correct return retry duplicated stock');
 perform pg_temp.ok((select released_at is not null from public.sale_empty_decisions where id=held_id),'Held property not collected during exchange');
 perform pg_temp.ok((select amount=4000 from public.money_owed where customer_id='20000000-0000-4000-8000-000000001001'),'Empty return changed money owed');
 begin
  perform public.record_customer_empty_return(gen_random_uuid(),'20000000-0000-4000-8000-000000001001','[{"crateTypeId":"50000000-0000-4000-8000-000000001001","quantity":1}]','[]','{}');
  raise exception 'Return exceeded debt';
 exception when invalid_parameter_value then null; end;
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001002',true);
do $$begin
 perform pg_temp.ok(not exists(select 1 from public.shop_profile),'Non-owner read shop details');
 perform pg_temp.ok(not exists(select 1 from public.sale_empty_decisions),'Non-owner read held property');
 begin perform public.save_business_details('Intruder','','',''); raise exception 'Non-owner edited shop'; exception when insufficient_privilege then null; end;
 begin perform public.record_customer_empty_return(gen_random_uuid(),'20000000-0000-4000-8000-000000001001','[]','[]','{}'); raise exception 'Non-owner recorded returns'; exception when insufficient_privilege then null; end;
 begin perform public.release_held_empties(gen_random_uuid()); raise exception 'Non-owner released held property'; exception when insufficient_privilege then null; end;
end$$;
set local role anon;
do $$begin
 begin perform * from public.sale_empty_decisions; raise exception 'Anonymous held property read'; exception when insufficient_privilege then null; end;
 begin perform public.save_business_details('Intruder','','',''); raise exception 'Anonymous shop write'; exception when insufficient_privilege then null; end;
end$$;
rollback;
