-- M2f-18 adversarial mixed-payment request namespace contract.
-- Both old-debt saver paths must save and replay when another business has
-- an identical deterministic derived payment UUID. All changes ROLLBACK.
begin;

insert into auth.users(id) values
 ('89d00000-0000-4000-8000-000000000001'),
 ('89d00000-0000-4000-8000-000000000002');
insert into private.shop_owner(user_id)
 values('89d00000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
insert into public.crate_types(id,name,empty_family,pocket_count)
 values ('89d00000-0000-4000-9000-000000000011','Legacy 12-bottle','NB',12);
insert into public.products(
 id,name,bottles_per_crate,full_crate_price,bottle_price,bottles_returnable,crate_type_id
) values(
 '89d00000-0000-4000-9000-000000000012',
 'Legacy split drink',12,20400,1700,false,'89d00000-0000-4000-9000-000000000011'
);
insert into public.stock(product_id,total_bottles)
 values('89d00000-0000-4000-9000-000000000012',100);
insert into public.customers(id,name,phone)
 values('89d00000-0000-4000-9000-000000000013','Original debt buyer','08000890113');
insert into public.money_owed(customer_id,amount)
 values('89d00000-0000-4000-9000-000000000013',1000);

select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate$
declare r record;n int:=0;
begin
 for r in
 select ns.nspname s,c.relname t,k.conname
   from pg_constraint k
   join pg_class c on c.oid=k.conrelid
   join pg_namespace ns on ns.oid=c.relnamespace
   join private.legacy_scope_tables() tab
     on tab.schema_name=ns.nspname and tab.table_name=c.relname
  where k.contype='f' and left(k.conname,7)='tenant_'
 loop
   execute format('alter table %I.%I validate constraint %I',
     r.s,r.t,r.conname);
   n:=n+1;
 end loop;
 if n<>31 then raise exception 'Missing tenant FK count %',n;end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

insert into private.businesses(id,status)
 values('89d00000-0000-4000-9000-000000000021','active');
insert into private.business_memberships(
  business_id,user_id,status,member_kind
) values (
 '89d00000-0000-4000-9000-000000000021',
 '89d00000-0000-4000-8000-000000000002','active','owner'
);

-- No new-shop operational RPC is enabled. Prepare ONLY foreign admin test
-- records to stress deterministic receipt collisions. Restore all triggers
-- before exercising the real original-shop checkout.
set local session_replication_role=replica;
insert into public.customers(id,name,phone,business_id)
values('89d00000-0000-4000-9000-000000000022','Foreign debt buyer',
 '08000890222','89d00000-0000-4000-9000-000000000021');
insert into public.customer_payments(
  customer_id,amount,owed_after,business_date,request_id,method,business_id,
  receipt_customer_name,receipt_customer_name_source
) values
(
  '89d00000-0000-4000-9000-000000000022',
  13,0,'2026-10-17',
  md5('depotflow:old-debt:'||'89d00000-0000-4000-9000-000000000091')::uuid,
  'pos','89d00000-0000-4000-9000-000000000021',
  'Foreign debt buyer','captured'
),(
  '89d00000-0000-4000-9000-000000000022',
  17,0,'2026-10-17',
  md5('depotflow:old-debt:'||'89d00000-0000-4000-9000-000000000092')::uuid,
  'transfer','89d00000-0000-4000-9000-000000000021',
  'Foreign debt buyer','captured'
);
set local session_replication_role=origin;

create function pg_temp.lines() returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object(
  'productId','89d00000-0000-4000-9000-000000000012',
  'quantity',jsonb_build_object('crates',0,'fraction',0,'bottles',1),
  'cratesTaken',0,'returnedCrates',0,'returnedBottles',0,
  'expected',jsonb_build_object('full',20400,'half',null,'quarter',null,
    'bottle',1700,'size',12,
    'crate','89d00000-0000-4000-9000-000000000011',
    'returnable',false,'bottleType',null)
 ));
$$;
create function pg_temp.split_legs() returns jsonb language sql as $$
 select jsonb_build_array(
  jsonb_build_object('method','cash','saleAmount',700,'oldDebtAmount',100,'amount',800),
  jsonb_build_object('method','transfer','saleAmount',1000,'oldDebtAmount',0,'amount',1000)
 );
$$;
create function pg_temp.pos_legs() returns jsonb language sql as $$
 select jsonb_build_array(
  jsonb_build_object('method','cash','saleAmount',700,'oldDebtAmount',100,'amount',800),
  jsonb_build_object('method','pos','saleAmount',1000,'oldDebtAmount',0,'amount',1000)
 );
$$;

-- Signed-in legacy owner saves TWO genuine staged transactions, one old
-- Cash+Transfer and one new Cash+POS, while the foreign B receipt already
-- owns the derived old-debt UUID. Both immutable ledger checks must pass.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89d00000-0000-4000-8000-000000000001',true);
do $save_and_replay_each$
declare
 v_first jsonb;
 v_again jsonb;
 v_request uuid;
 v_legs jsonb;
 v_expected_debt_payment uuid;
 v_method text;
begin
 for v_request,v_method in
  select * from (values
    ('89d00000-0000-4000-9000-000000000091'::uuid,'split'),
    ('89d00000-0000-4000-9000-000000000092'::uuid,'multi')
  ) x(request_id,mode)
 loop
  v_legs:=case when v_method='split'
    then pg_temp.split_legs() else pg_temp.pos_legs() end;
  if v_method='split' then
   v_first:=public.save_sale_split_tender(
     v_request,'89d00000-0000-4000-9000-000000000013',
     '2026-10-17',1700,pg_temp.lines(),'[]','[]',100,v_legs);
  else
   v_first:=public.save_sale_multi_tender(
     v_request,'89d00000-0000-4000-9000-000000000013',
     '2026-10-17',1700,pg_temp.lines(),'[]','[]',100,v_legs);
  end if;
  select id into v_expected_debt_payment
  from public.customer_payments
  where request_id=md5('depotflow:old-debt:'||v_request::text)::uuid
    and customer_id='89d00000-0000-4000-9000-000000000013';
  if v_expected_debt_payment is null then
   raise exception 'Missing original-shop linked old debt payment in %',v_method;
  end if;
  if v_first->>'oldDebtPaymentId' is distinct from v_expected_debt_payment::text
     or (v_first->>'oldDebtPaid')::integer<>100 then
    raise exception 'Initial sale linked wrong business debt receipt: %',v_first;
  end if;
  if v_method='split' then
   v_again:=public.save_sale_split_tender(
     v_request,'89d00000-0000-4000-9000-000000000013',
     '2026-10-17',1700,pg_temp.lines(),'[]','[]',100,v_legs);
  else
   v_again:=public.save_sale_multi_tender(
     v_request,'89d00000-0000-4000-9000-000000000013',
     '2026-10-17',1700,pg_temp.lines(),'[]','[]',100,v_legs);
  end if;
  if v_again->>'id' is distinct from v_first->>'id'
    or v_again->>'oldDebtPaymentId' is distinct from v_expected_debt_payment::text
    or (select count(*) from public.sale_tender_legs
       where sale_id=(v_first->>'id')::uuid)<>2 then
    raise exception 'Mixed-payment replay leaked B or changed saved tender: %',v_again;
  end if;
 end loop;
end;
$save_and_replay_each$;
reset role;

do $three_shop_rows$
begin
 if (select count(*) from public.sales)<>2
    or (select count(*) from public.customer_payments)<>4
    or (select total_bottles from public.stock
      where product_id='89d00000-0000-4000-9000-000000000012')<>98
    or (select amount from public.money_owed
      where customer_id='89d00000-0000-4000-9000-000000000013')<>800
    or (select count(*) from public.customer_payments
      where business_id='89d00000-0000-4000-9000-000000000021'
        and amount in (13,17))<>2 then
   raise exception 'Foreign payment collision changed stock/debt/receipts';
 end if;
end;
$three_shop_rows$;

rollback;
