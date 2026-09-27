-- Disposable migrated database only. Every fixture and mutation rolls back.
begin;
insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000301'),
  ('00000000-0000-4000-8000-000000000302');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000301');

-- Customer 401 is an unrelated control that is never archived.
-- Customer 402 is the subject: pre-existing balances/history, then archived,
-- paid against while archived, then restored.
insert into public.customers(id,name,phone) values
  ('10000000-0000-4000-8000-000000000401','Control customer','08000000401'),
  ('10000000-0000-4000-8000-000000000402','Archiving subject','08000000402');
insert into public.money_owed(customer_id,amount) values
  ('10000000-0000-4000-8000-000000000402',7000);
insert into public.deposits(customer_id,amount) values
  ('10000000-0000-4000-8000-000000000402',2000);
insert into public.crate_types(id,name,empty_family,pocket_count) values
  ('20000000-0000-4000-8000-000000000501','Archiving test crate','Test',12);
insert into public.crate_obligations(customer_id,crate_type_id,quantity) values
  ('10000000-0000-4000-8000-000000000402','20000000-0000-4000-8000-000000000501',3);
insert into public.bottle_obligations(customer_id,bottle_type,quantity) values
  ('10000000-0000-4000-8000-000000000402','Test bottle',5);
-- A pre-existing historical sale and payment: archiving must never touch these.
insert into public.sales(id,customer_id,total_amount,paid_amount) values
  ('40000000-0000-4000-8000-000000000701','10000000-0000-4000-8000-000000000402',15000,10000);
insert into public.customer_payments(customer_id,amount,owed_after,business_date,request_id) values
  ('10000000-0000-4000-8000-000000000402',10000,7000,'2026-09-01','40000000-0000-4000-8000-000000000801');
insert into public.products(id,name,bottles_per_crate,full_crate_price,half_crate_price,quarter_crate_price,bottle_price,bottles_returnable,crate_type_id)
values ('30000000-0000-4000-8000-000000000601','Archiving test drink',12,12000,6000,3000,1000,false,'20000000-0000-4000-8000-000000000501');
insert into public.stock(product_id,total_bottles) values ('30000000-0000-4000-8000-000000000601',100);

create function pg_temp.check_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end $$;

-- archived_at defaults to NULL for every new customer.
select pg_temp.check_true(
  (select archived_at is null from public.customers where id='10000000-0000-4000-8000-000000000401'),
  'archived_at did not default to NULL');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000301',true);

-- The owner can archive.
update public.customers set archived_at=now() where id='10000000-0000-4000-8000-000000000402';
select pg_temp.check_true(
  (select archived_at is not null from public.customers where id='10000000-0000-4000-8000-000000000402'),
  'Owner archive did not persist');
select pg_temp.check_true(
  (select archived_at is null from public.customers where id='10000000-0000-4000-8000-000000000401'),
  'Archiving one customer archived another');

-- Archiving alone must not touch any balance or history table.
select pg_temp.check_true((select amount=7000 from public.money_owed where customer_id='10000000-0000-4000-8000-000000000402'),'Archive changed money owed');
select pg_temp.check_true((select amount=2000 from public.deposits where customer_id='10000000-0000-4000-8000-000000000402'),'Archive changed deposits');
select pg_temp.check_true((select quantity=3 from public.crate_obligations where customer_id='10000000-0000-4000-8000-000000000402'),'Archive changed crate obligations');
select pg_temp.check_true((select quantity=5 from public.bottle_obligations where customer_id='10000000-0000-4000-8000-000000000402'),'Archive changed bottle obligations');
select pg_temp.check_true((select total_amount=15000 and paid_amount=10000 from public.sales where id='40000000-0000-4000-8000-000000000701'),'Archive changed a historical sale');
select pg_temp.check_true((select count(*)=1 from public.customer_payments where customer_id='10000000-0000-4000-8000-000000000402'),'Archive changed payment history');

-- Active-customer / archived-customer filters, as used by the normal
-- customer list, Record Sale's catalog, and the Archived Customers list.
select pg_temp.check_true(
  (select array_agg(id order by id) from public.customers where archived_at is null)
    = array['10000000-0000-4000-8000-000000000401'::uuid],
  'Active-customer filter returned the wrong rows');
select pg_temp.check_true(
  (select array_agg(id order by id) from public.customers where archived_at is not null)
    = array['10000000-0000-4000-8000-000000000402'::uuid],
  'Archived-customer filter returned the wrong rows');

-- Archived row remains fully readable to the owner.
select pg_temp.check_true(
  (select name='Archiving subject' from public.customers where id='10000000-0000-4000-8000-000000000402'),
  'Archived customer became unreadable');

do $$
declare
  line jsonb;
  result jsonb;
begin
  -- A sale attempt for the archived customer is rejected by the database,
  -- even though the sale flow already hides them from the catalog: a
  -- paused/stale draft can still reference a customer archived meanwhile.
  line:=jsonb_build_object('productId','30000000-0000-4000-8000-000000000601',
    'quantity',jsonb_build_object('crates',1,'fraction',0,'bottles',0),
    'returnedCrates',0,'returnedBottles',0,
    'expected',jsonb_build_object('full',12000,'half',6000,'quarter',3000,'bottle',1000,
      'size',12,'crate','20000000-0000-4000-8000-000000000501','returnable',false,'bottleType',null,'stock',100));
  begin
    perform public.save_sale('40000000-0000-4000-8000-000000000901','10000000-0000-4000-8000-000000000402','2026-09-26',12000,jsonb_build_array(line));
    raise exception 'Archived-customer sale was accepted';
  exception when invalid_parameter_value then
    if sqlerrm <> 'This customer is archived. Restore them before recording a new sale.' then
      raise exception 'Unexpected archived-customer error: %',sqlerrm;
    end if;
  end;
  if exists(select 1 from public.sales where customer_id='10000000-0000-4000-8000-000000000402' and total_amount<>15000) then
    raise exception 'Rejected archived-customer sale still persisted a sale';
  end if;
  if (select total_bottles from public.stock where product_id='30000000-0000-4000-8000-000000000601')<>100 then
    raise exception 'Rejected archived-customer sale still changed stock';
  end if;
end $$;

-- Record Payment must still work for an archived customer who owes money.
select public.record_payment('40000000-0000-4000-8000-000000000902','10000000-0000-4000-8000-000000000402',3000,'2026-09-26');
select pg_temp.check_true((select amount=4000 from public.money_owed where customer_id='10000000-0000-4000-8000-000000000402'),'Payment against archived customer did not reduce money owed');
select pg_temp.check_true((select count(*)=2 from public.customer_payments where customer_id='10000000-0000-4000-8000-000000000402'),'Payment against archived customer was not recorded');

-- Restore makes the customer available again, and touches nothing else.
update public.customers set archived_at=null where id='10000000-0000-4000-8000-000000000402';
select pg_temp.check_true((select archived_at is null from public.customers where id='10000000-0000-4000-8000-000000000402'),'Restore did not persist');
select pg_temp.check_true(
  (select array_agg(id order by id) from public.customers where archived_at is null)
    = array['10000000-0000-4000-8000-000000000401'::uuid,'10000000-0000-4000-8000-000000000402'::uuid],
  'Restored customer missing from active-customer filter');
select pg_temp.check_true((select amount=4000 from public.money_owed where customer_id='10000000-0000-4000-8000-000000000402'),'Restore changed money owed');
select pg_temp.check_true((select amount=2000 from public.deposits where customer_id='10000000-0000-4000-8000-000000000402'),'Restore changed deposits');
select pg_temp.check_true((select quantity=3 from public.crate_obligations where customer_id='10000000-0000-4000-8000-000000000402'),'Restore changed crate obligations');
select pg_temp.check_true((select quantity=5 from public.bottle_obligations where customer_id='10000000-0000-4000-8000-000000000402'),'Restore changed bottle obligations');
select pg_temp.check_true((select total_amount=15000 and paid_amount=10000 from public.sales where id='40000000-0000-4000-8000-000000000701'),'Restore changed a historical sale');

-- Restoring the customer allows a new sale again.
do $$
declare line jsonb; result jsonb;
begin
  line:=jsonb_build_object('productId','30000000-0000-4000-8000-000000000601',
    'quantity',jsonb_build_object('crates',1,'fraction',0,'bottles',0),
    'returnedCrates',0,'returnedBottles',0,
    'expected',jsonb_build_object('full',12000,'half',6000,'quarter',3000,'bottle',1000,
      'size',12,'crate','20000000-0000-4000-8000-000000000501','returnable',false,'bottleType',null,'stock',100));
  result:=public.save_sale('40000000-0000-4000-8000-000000000903','10000000-0000-4000-8000-000000000402','2026-09-26',12000,jsonb_build_array(line));
  if (result->>'total')::integer<>12000 then raise exception 'Restored-customer sale failed: %',result; end if;
end $$;

-- A non-owner authenticated session cannot archive or restore: same
-- owner-only RLS policy and column grant that governs every other column.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000302',true);
do $$ declare changed integer; begin
  update public.customers set archived_at=now() where id='10000000-0000-4000-8000-000000000401';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Non-owner archive permitted'; end if;
end $$;
do $$ declare changed integer; begin
  update public.customers set archived_at=now() where id='10000000-0000-4000-8000-000000000402';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Non-owner re-archive permitted'; end if;
end $$;

-- Switch back to the owner to read the result: the non-owner session's own
-- SELECT policy hides every customer row, so it cannot be used to verify
-- the non-owner's update had no effect.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000301',true);
select pg_temp.check_true(
  (select archived_at is null from public.customers where id='10000000-0000-4000-8000-000000000401'),
  'Non-owner update changed a customer despite affecting zero rows');
-- Customer 402 was already restored above; the non-owner's attempted
-- re-archive must not have changed that.
select pg_temp.check_true(
  (select archived_at is null from public.customers where id='10000000-0000-4000-8000-000000000402'),
  'Non-owner update changed the restored customer despite affecting zero rows');

-- Anon has no grant on the customers table at all.
set local role anon;
do $$ begin
  begin
    update public.customers set archived_at=now() where id='10000000-0000-4000-8000-000000000401';
    raise exception 'Anon archive was permitted';
  exception when insufficient_privilege then null; end;
  begin
    update public.customers set archived_at=null where id='10000000-0000-4000-8000-000000000402';
    raise exception 'Anon restore was permitted';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
rollback;
