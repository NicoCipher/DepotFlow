-- Disposable migrated database only. Every fixture and failure trigger rolls back.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000041'),('00000000-0000-4000-8000-000000000042');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000041');
insert into public.products(id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type)
values ('10000000-0000-4000-8000-000000000041','Count test',12,0,false,'exact');
insert into public.stock values ('10000000-0000-4000-8000-000000000041',100);
insert into public.empty_crate_stock values ('exact',10);
-- A pre-migration retry record must never be received again or assigned an invented date.
insert into private.stock_receipts values ('20000000-0000-4000-8000-000000000040','10000000-0000-4000-8000-000000000041',1,100,10,null);
create function pg_temp.check_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000041',true);
select public.set_current_stock('20000000-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000041',2,5,'2024-02-29',100,12);
select public.set_current_stock('20000000-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000041',2,5,'2024-02-29',100,12);
select pg_temp.check_true((select total_bottles=29 from public.stock),'Count did not replace stock');
select pg_temp.check_true((select quantity=10 from public.empty_crate_stock),'Count changed empties');
select pg_temp.check_true((select count(*)=1 from public.stock_movements),'Count retry duplicated history');
select pg_temp.check_true((select quantity_change=-71 and resulting_stock=29 and movement_type='count' and business_date='2024-02-29' and created_at::date <> business_date from public.stock_movements),'Wrong count history or business date');
select public.receive_stock('20000000-0000-4000-8000-000000000042','10000000-0000-4000-8000-000000000041',2,29,10,12,'exact','2024-03-01');
select public.receive_stock('20000000-0000-4000-8000-000000000042','10000000-0000-4000-8000-000000000041',2,29,10,12,'exact','2024-03-01');
select pg_temp.check_true((select count(*)=2 from public.stock_movements),'Receipt retry duplicated history');
select pg_temp.check_true((select quantity_change=24 and resulting_stock=53 and movement_type='receive' and business_date='2024-03-01' from public.stock_movements where request_id='20000000-0000-4000-8000-000000000042'),'Wrong receipt history');
-- Old count retry after a receipt must not rewind stock.
select public.set_current_stock('20000000-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000041',2,5,'2024-02-29',100,12);
select pg_temp.check_true((select total_bottles=53 from public.stock),'Count retry rewound stock');
do $$ declare n numeric; d date; begin
  foreach n in array array[-1,0.5,2147483648,'NaN'::numeric,'Infinity'::numeric,null] loop
    begin
      perform public.set_current_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000041',n,0,'2024-03-02',53,12);
      raise exception 'Invalid crates accepted';
    exception when invalid_parameter_value then null; end;
    begin
      perform public.set_current_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000041',0,n,'2024-03-02',53,12);
      raise exception 'Invalid bottles accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  foreach d in array array[null,'infinity'::date,'-infinity'::date,'10000-01-01'::date] loop
    begin
      perform public.set_current_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000041',0,0,d,53,12);
      raise exception 'Invalid count date accepted';
    exception when invalid_parameter_value then null; end;
    begin
      perform public.receive_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000041',1,53,8,12,'exact',d);
      raise exception 'Invalid receive date accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    perform public.set_current_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000041',0,12,'2024-03-02',53,12);
    raise exception 'Full crate remainder accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_current_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000041',2147483647,0,'2024-03-02',53,12);
    raise exception 'Overflow accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_current_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000041',1,0,'2024-03-02',29,12);
    raise exception 'Stale count accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_current_stock('20000000-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000041',2,6,'2024-02-29',53,12);
    raise exception 'Changed count retry accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_current_stock('20000000-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000041',2,5,'2024-03-01',53,12);
    raise exception 'Changed date retry accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.receive_stock('20000000-0000-4000-8000-000000000042','10000000-0000-4000-8000-000000000041',2,53,8,12,'exact','2024-03-02');
    raise exception 'Changed receipt date accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.receive_stock('20000000-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000041',2,53,8,12,'exact','2024-03-02');
    raise exception 'Count id reused for receiving';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_current_stock('20000000-0000-4000-8000-000000000042','10000000-0000-4000-8000-000000000041',2,0,'2024-03-01',53,12);
    raise exception 'Receipt id reused for count';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.receive_stock('20000000-0000-4000-8000-000000000040','10000000-0000-4000-8000-000000000041',1,53,8,12,'exact','2024-03-02');
    raise exception 'Legacy receipt replayed';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_current_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000041',0,0,'2026-02-30',53,12);
    raise exception 'Impossible calendar date accepted';
  exception when datetime_field_overflow then null; end;
  begin
    update public.stock set total_bottles=1;
    raise exception 'Direct stock writes allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.stock_movements set quantity_change=1;
    raise exception 'History rewrite allowed';
  exception when insufficient_privilege then null; end;
end $$;
-- Failure while writing history must undo stock, empties, AND retry records.
reset role;
create function pg_temp.fail_history() returns trigger language plpgsql as $$ begin raise exception using errcode='23514',message='forced history failure'; end $$;
create trigger history_test_failure before insert on public.stock_movements for each row execute function pg_temp.fail_history();
set local role authenticated;
do $$ begin
  begin
    perform public.set_current_stock('20000000-0000-4000-8000-000000000043','10000000-0000-4000-8000-000000000041',0,0,'2024-03-02',53,12);
    raise exception 'Expected history failure';
  exception when check_violation then null; end;
  begin
    perform public.receive_stock('20000000-0000-4000-8000-000000000044','10000000-0000-4000-8000-000000000041',1,53,8,12,'exact','2024-03-02');
    raise exception 'Expected history failure';
  exception when check_violation then null; end;
end $$;
select pg_temp.check_true((select total_bottles=53 from public.stock),'History failure left changed stock');
select pg_temp.check_true((select quantity=8 from public.empty_crate_stock),'History failure left changed empties');
select pg_temp.check_true((select count(*)=2 from public.stock_movements),'Failed history persisted');
reset role;
select pg_temp.check_true(not exists(select 1 from private.stock_receipts where request_id='20000000-0000-4000-8000-000000000044'),'Failed retry record persisted');
drop trigger history_test_failure on public.stock_movements;
set local role authenticated;
select public.set_current_stock('20000000-0000-4000-8000-000000000043','10000000-0000-4000-8000-000000000041',0,0,'2024-03-02',53,12);
select pg_temp.check_true((select total_bottles=0 from public.stock),'Zero count or retry after rollback failed');
select pg_temp.check_true((select quantity_change=-53 and resulting_stock=0 from public.stock_movements where request_id='20000000-0000-4000-8000-000000000043'),'Zero count history wrong');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000042',true);
select pg_temp.check_true(not exists(select 1 from public.stock_movements),'Non-owner read history');
do $$ begin
  begin
    perform public.set_current_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000041',1,0,'2024-03-02',0,12);
    raise exception 'Non-owner set stock';
  exception when insufficient_privilege then null; end;
  begin
    perform private.set_current_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000041',1,0,'2024-03-02',0,12);
    raise exception 'Private count bypassed owner';
  exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
  begin
    perform public.set_current_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000041',1,0,'2024-03-02',0,12);
    raise exception 'Anonymous set stock';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.stock_movements;
    raise exception 'Anonymous read history';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.check_true((select relrowsecurity from pg_class where oid='public.stock_movements'::regclass),'Missing history RLS');
select pg_temp.check_true(to_regprocedure('public.receive_stock(uuid,uuid,numeric,integer,integer,integer,text)') is null,'Undated receive path remains');
rollback;
