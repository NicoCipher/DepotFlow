-- Disposable Postgres fixture: versioned split saver remains unavailable to UI.
begin;
insert into auth.users(id) values
 ('00000000-0000-4000-8000-000000009601'),
 ('00000000-0000-4000-8000-000000009602');
insert into private.shop_owner(user_id)
 values ('00000000-0000-4000-8000-000000009601');
insert into public.crate_types(id,name,empty_family,pocket_count)
 values ('50000000-0000-4000-8000-000000009601','Split Test 12','Test',12);
insert into public.products(
 id,name,bottles_per_crate,full_crate_price,bottle_price,
 bottles_returnable,crate_type_id
) values (
 '10000000-0000-4000-8000-000000009601','Split Tender Drink',12,20400,1700,
 false,'50000000-0000-4000-8000-000000009601'
);
insert into public.stock(product_id,total_bottles)
 values ('10000000-0000-4000-8000-000000009601',100);
insert into public.customers(id,name,phone)
 values ('20000000-0000-4000-8000-000000009601','Tender Ledger Client','08000009601');
insert into public.money_owed(customer_id,amount)
 values ('20000000-0000-4000-8000-000000009601',2000);
create function pg_temp.ok(v boolean,m text) returns void language plpgsql as $$
begin if v is distinct from true then raise exception '%',m; end if; end $$;
create function pg_temp.lines() returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object(
 'productId','10000000-0000-4000-8000-000000009601',
 'quantity',jsonb_build_object('crates',0,'fraction',0,'bottles',1),
 'cratesTaken',0,'returnedCrates',0,'returnedBottles',0,
 'expected',jsonb_build_object('full',20400,'half',null,'quarter',null,
 'bottle',1700,'size',12,'crate','50000000-0000-4000-8000-000000009601',
 'returnable',false,'bottleType',null)));
$$;
create function pg_temp.cash_transfer(
  a integer,b integer,c integer,d integer
) returns jsonb language sql as $$
 select jsonb_build_array(
   jsonb_build_object('method','cash','saleAmount',a,'oldDebtAmount',b,'amount',a+b),
   jsonb_build_object('method','transfer','saleAmount',c,'oldDebtAmount',d,'amount',c+d)
 );
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009601',true);
do $$ declare v jsonb; begin
 v := public.save_sale_split_tender(
  '40000000-0000-4000-8000-000000009601',
  '20000000-0000-4000-8000-000000009601','2026-10-16',
  1700,pg_temp.lines(),'[]','[]',0,pg_temp.cash_transfer(700,0,1000,0));
 perform pg_temp.ok((v->>'total')::int=1700 and
  (v->>'paid')::int=1700 and
  jsonb_array_length(v->'tenders')=2,'Split sale result incorrect');
 perform pg_temp.ok((select count(*)=2 and sum(sale_amount)=1700
   from public.sale_tender_legs where sale_id=(v->>'id')::uuid),
   'Split sale tender ledger was not committed');
 perform pg_temp.ok((select payment_method='mixed' and
   split_request_hash is not null from public.sales where id=(v->>'id')::uuid),
   'Split sale method or fingerprint was not stored');
 perform pg_temp.ok((select amount=2000 from public.money_owed where
   customer_id='20000000-0000-4000-8000-000000009601'),
   'Fully paid sale changed previous customer debt');
 perform pg_temp.ok((select total_bottles=99 from public.stock where
   product_id='10000000-0000-4000-8000-000000009601'),
   'Split sale did not deduct stock once');
end $$;

-- Replayed request returns existing row/legs without new sale or stock movement.
select pg_temp.ok(
 (select public.save_sale_split_tender(
  '40000000-0000-4000-8000-000000009601',
  '20000000-0000-4000-8000-000000009601','2026-10-16',
  1700,pg_temp.lines(),'[]','[]',0,pg_temp.cash_transfer(700,0,1000,0))->>'total')='1700',
 'Idempotent replay failed');
select pg_temp.ok((select count(*)=1 from public.sales where
 request_id='40000000-0000-4000-8000-000000009601'),
 'Idempotent replay duplicated sale');
select pg_temp.ok((select total_bottles=99 from public.stock where
 product_id='10000000-0000-4000-8000-000000009601'),
 'Idempotent replay deducted stock twice');

-- An old-debt payment and a partial new-sale payment must remain distinct.
do $$ declare v jsonb; begin
 v := public.save_sale_split_tender(
  '40000000-0000-4000-8000-000000009602',
  '20000000-0000-4000-8000-000000009601','2026-10-16',
  1200,pg_temp.lines(),'[]','[]',500,pg_temp.cash_transfer(500,200,700,300));
 perform pg_temp.ok((v->>'balanceAfter')::int=2000,
   'Old and new debt closing balance is wrong');
 perform pg_temp.ok((select count(*)=2 and sum(sale_amount)=1200
    and sum(old_debt_amount)=500
    from public.sale_tender_legs where sale_id=(v->>'id')::uuid),
    'Combined tender allocation incorrect');
 perform pg_temp.ok((select method='mixed' and amount=500 from
    public.customer_payments where
      request_id=md5('depotflow:old-debt:' ||
         '40000000-0000-4000-8000-000000009602')::uuid),
    'Old-debt receipt did not retain exact split method');
 perform pg_temp.ok((select total_bottles=98 from public.stock
   where product_id='10000000-0000-4000-8000-000000009601'),
   'Combined checkout modified stock incorrectly');
end $$;

-- Reject invalid splits and never create ledger, sale, or stock movement.
do $$ begin
 begin
   perform public.save_sale_split_tender(
    '40000000-0000-4000-8000-000000009603',
    '20000000-0000-4000-8000-000000009601','2026-10-16',
    1700,pg_temp.lines(),'[]','[]',0,pg_temp.cash_transfer(700,0,900,0));
   raise exception 'Missing transfer amount accepted';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.save_sale_split_tender(
    '40000000-0000-4000-8000-000000009603',
    '20000000-0000-4000-8000-000000009601','2026-10-16',
    1700,pg_temp.lines(),'[]','[]',0,pg_temp.cash_transfer(1700,0,0,0));
   raise exception 'A zero transfer leg was accepted';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.save_sale_split_tender(
    '40000000-0000-4000-8000-000000009601',
    '20000000-0000-4000-8000-000000009601','2026-10-16',
    1700,pg_temp.lines(),'[]','[]',0,pg_temp.cash_transfer(800,0,900,0));
   raise exception 'Changed tender replay was accepted';
 exception when invalid_parameter_value then null; end;
 begin
   perform public.save_sale_split_tender(
    '40000000-0000-4000-8000-000000009601',
    '20000000-0000-4000-8000-000000009601','2026-10-17',
    1700,pg_temp.lines(),'[]','[]',0,pg_temp.cash_transfer(700,0,1000,0));
   raise exception 'Changed date replay was accepted';
 exception when invalid_parameter_value then null; end;
end $$;
select pg_temp.ok(not exists(select 1 from public.sales where
 request_id='40000000-0000-4000-8000-000000009603'),
 'Failed split created a sale');
select pg_temp.ok((select total_bottles=98 from public.stock where
 product_id='10000000-0000-4000-8000-000000009601'),
 'Failed split modified stock');

-- Existing public single-method RPC must not accept fake mixed payments.
do $$ begin
 begin
  perform public.save_sale_with_old_debt_payment(
    '40000000-0000-4000-8000-000000009604',
    '20000000-0000-4000-8000-000000009601','2026-10-16',
    1700,pg_temp.lines(),'[]','[]','mixed',0);
  raise exception 'Legacy saver accepted mixed without the tender ledger';
 exception when invalid_parameter_value then null; end;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009602',true);
do $$ begin
 begin
  perform public.save_sale_split_tender(
    '40000000-0000-4000-8000-000000009605',
    '20000000-0000-4000-8000-000000009601','2026-10-16',
    1700,pg_temp.lines(),'[]','[]',0,pg_temp.cash_transfer(700,0,1000,0));
  raise exception 'Non-owner saved a split';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
