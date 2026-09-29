-- Disposable migrated database only. All fixtures roll back.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000009301'),('00000000-0000-4000-8000-000000009302');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000009301');
insert into public.customers(id,name,phone) values
 ('10000000-0000-4000-8000-000000009301','Existing customer','08000009301'),
 ('10000000-0000-4000-8000-000000009302','Rollback customer','08000009302');
insert into public.crate_types(id,name,empty_family,pocket_count) values ('50000000-0000-4000-8000-000000009301','Test exact crate','Test',12);
insert into public.products(id,name,bottles_per_crate,full_crate_price,bottles_returnable,bottle_type,crate_type_id) values
 ('60000000-0000-4000-8000-000000009301','Test drink',12,12000,true,'Test bottle','50000000-0000-4000-8000-000000009301');
insert into public.stock(product_id,total_bottles) values ('60000000-0000-4000-8000-000000009301',120);
insert into public.money_owed(customer_id,amount) values ('10000000-0000-4000-8000-000000009301',2000);
insert into public.crate_obligations(customer_id,crate_type_id,crate_type,quantity) values ('10000000-0000-4000-8000-000000009301','50000000-0000-4000-8000-000000009301','Test exact crate',1);
insert into public.bottle_obligations(customer_id,bottle_type,quantity) values ('10000000-0000-4000-8000-000000009301','Test bottle',3);
create function pg_temp.ok(v boolean,m text) returns void language plpgsql as $$begin if v is distinct from true then raise exception '%',m; end if; end$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009301',true);
select public.record_opening_balances('20000000-0000-4000-8000-000000009301','10000000-0000-4000-8000-000000009301',10000,'2026-09-28','Old notebook','[{"type":"50000000-0000-4000-8000-000000009301","quantity":2}]','[{"type":"Test bottle","quantity":24}]');
select public.record_opening_balances('20000000-0000-4000-8000-000000009301','10000000-0000-4000-8000-000000009301',10000,'2026-09-28','Old notebook','[{"type":"50000000-0000-4000-8000-000000009301","quantity":2}]','[{"type":"Test bottle","quantity":24}]');
select pg_temp.ok((select amount=12000 from public.money_owed where customer_id='10000000-0000-4000-8000-000000009301'),'Money overwritten or duplicated');
select pg_temp.ok((select quantity=3 from public.crate_obligations where customer_id='10000000-0000-4000-8000-000000009301'),'Crates overwritten or duplicated');
select pg_temp.ok((select quantity=27 from public.bottle_obligations where customer_id='10000000-0000-4000-8000-000000009301'),'Bottles overwritten or duplicated');
select pg_temp.ok((select count(*)=1 from public.customer_opening_balances),'Opening record duplicated');
select pg_temp.ok((select total_bottles=120 from public.stock),'Opening debt changed physical stock');
select pg_temp.ok(not exists(select 1 from public.sales) and not exists(select 1 from public.customer_payments),'Opening debt invented sales or payments');
select pg_temp.ok((public.manager_snapshot('2026-09-28')->>'received')::int=0 and (public.manager_snapshot('2026-09-28')->>'sales_value')::int=0,'Opening debt inflated sales or money received');
select pg_temp.ok((public.store_activity('2026-09-28','2026-09-28',null,'opening',30,0)->>'count')::int=1,'Opening history missing');
select pg_temp.ok((public.store_activity('2026-09-28','2026-09-28',null,'all',30,0)->>'received')::int=0,'Opening history inflated cash received');
do $$begin
  begin perform public.record_opening_balances(gen_random_uuid(),'10000000-0000-4000-8000-000000009301',10000,'2026-09-28','','[]','[]');raise exception 'Second opening accepted';exception when invalid_parameter_value then null;end;
  begin perform public.record_opening_balances('20000000-0000-4000-8000-000000009301','10000000-0000-4000-8000-000000009301',9999,'2026-09-28','','[]','[]');raise exception 'Changed replay accepted';exception when invalid_parameter_value then null;end;
  begin perform public.record_opening_balances(gen_random_uuid(),'10000000-0000-4000-8000-000000009302',0,'2026-09-28','','[]','[]');raise exception 'Empty opening accepted';exception when invalid_parameter_value then null;end;
  begin perform public.record_opening_balances(gen_random_uuid(),'10000000-0000-4000-8000-000000009302',-1,'2026-09-28','','[]','[]');raise exception 'Negative amount accepted';exception when invalid_parameter_value then null;end;
  begin perform public.record_opening_balances(gen_random_uuid(),'10000000-0000-4000-8000-000000009302',100,'2026-09-28','','[]','[{"type":"Unknown bottle","quantity":1}]');raise exception 'Unknown bottle accepted';exception when invalid_parameter_value then null;end;
  begin perform public.record_opening_balances(gen_random_uuid(),'10000000-0000-4000-8000-000000009302',100,'2026-09-28','','[]','[{"type":"Test bottle","quantity":1},{"type":"Test bottle","quantity":2}]');raise exception 'Duplicate type accepted';exception when invalid_parameter_value then null;end;
end$$;
select pg_temp.ok(not exists(select 1 from public.money_owed where customer_id='10000000-0000-4000-8000-000000009302'),'Rejected opening left money debt');
-- Paying old debt uses the existing payment flow; replay must not put debt back.
select public.record_payment('20000000-0000-4000-8000-000000009399','10000000-0000-4000-8000-000000009301',3000,'2026-09-28','cash');
select public.record_opening_balances('20000000-0000-4000-8000-000000009301','10000000-0000-4000-8000-000000009301',10000,'2026-09-28','Old notebook','[{"type":"50000000-0000-4000-8000-000000009301","quantity":2}]','[{"type":"Test bottle","quantity":24}]');
select pg_temp.ok((select amount=9000 from public.money_owed where customer_id='10000000-0000-4000-8000-000000009301'),'Retry undid a later payment');
do $$begin
  begin update public.customer_opening_balances set amount=1;raise exception 'Direct edit allowed';exception when insufficient_privilege then null;end;
  begin delete from public.customer_opening_balances;raise exception 'Direct deletion allowed';exception when insufficient_privilege then null;end;
end$$;
reset role;
create function pg_temp.fail_opening() returns trigger language plpgsql as $$begin raise exception using errcode='23514',message='forced failure';end$$;
create trigger test_opening_failure before insert on public.customer_opening_balances for each row execute function pg_temp.fail_opening();
set local role authenticated;
do $$begin
 begin perform public.record_opening_balances(gen_random_uuid(),'10000000-0000-4000-8000-000000009302',1000,'2026-09-28','','[{"type":"50000000-0000-4000-8000-000000009301","quantity":2}]','[{"type":"Test bottle","quantity":24}]');raise exception 'Forced failure accepted';exception when check_violation then null;end;
end$$;
select pg_temp.ok(not exists(select 1 from public.money_owed where customer_id='10000000-0000-4000-8000-000000009302') and not exists(select 1 from public.crate_obligations where customer_id='10000000-0000-4000-8000-000000009302') and not exists(select 1 from public.bottle_obligations where customer_id='10000000-0000-4000-8000-000000009302'),'Failed save left partial debt');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000009302',true);
select pg_temp.ok((select count(*)=0 from public.customer_opening_balances),'Nonowner read opening balances');
do $$begin
 begin perform public.record_opening_balances(gen_random_uuid(),'10000000-0000-4000-8000-000000009302',1000,'2026-09-28','','[]','[]');raise exception 'Nonowner wrote opening';exception when insufficient_privilege then null;end;
end$$;
set local role anon;
do $$begin
 begin perform public.record_opening_balances(gen_random_uuid(),'10000000-0000-4000-8000-000000009302',1000,'2026-09-28','','[]','[]');raise exception 'Anonymous opening accepted';exception when insufficient_privilege then null;end;
end$$;
rollback;
