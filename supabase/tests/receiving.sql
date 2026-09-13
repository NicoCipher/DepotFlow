-- Disposable migrated database only; fixtures and test trigger roll back.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000031'),('00000000-0000-4000-8000-000000000032');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000031');
insert into public.products(id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type,empty_family) values
 ('10000000-0000-4000-8000-000000000031','Receive test',12,0,false,'exact','same family'),
 ('10000000-0000-4000-8000-000000000032','Missing empties',24,0,false,'other','same family');
insert into public.stock values ('10000000-0000-4000-8000-000000000031',5);
insert into public.empty_crate_stock values ('exact',10);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000031',true);
select public.receive_stock('20000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000031',2,5,10,12,'exact');
-- Retry does not double receive, even though the old review is now stale.
select public.receive_stock('20000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000031',2,5,10,12,'exact');
do $$ declare n numeric; begin
  if (select total_bottles from public.stock where product_id='10000000-0000-4000-8000-000000000031') <> 29 then raise exception 'Wrong stock or double receive'; end if;
  if (select quantity from public.empty_crate_stock where crate_type='exact') <> 8 then raise exception 'Wrong empty count'; end if;
  foreach n in array array[0,-1,1.5,9,'NaN'::numeric,'Infinity'::numeric] loop
    begin
      perform public.receive_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000031',n,29,8,12,'exact');
      raise exception 'Invalid or insufficient quantity accepted: %', n;
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    perform public.receive_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000032',1,0,0,24,'other');
    raise exception 'Family compatibility inferred';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.receive_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000031',1,5,10,12,'exact');
    raise exception 'Stale review accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.receive_stock('20000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000031',3,29,8,12,'exact');
    raise exception 'Changed retry accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update public.empty_crate_stock set quantity=100;
    raise exception 'Direct empty writes allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.stock set total_bottles=100;
    raise exception 'Direct stock writes allowed';
  exception when insufficient_privilege then null; end;
end $$;
-- Inject a failure in the second update to prove the first update rolls back.
reset role;
create function pg_temp.fail_receiving_test() returns trigger language plpgsql as $$ begin raise exception using errcode='23514',message='forced stock failure'; end $$;
create trigger receiving_test_failure before update on public.stock for each row execute function pg_temp.fail_receiving_test();
set local role authenticated;
do $$ begin
  begin
    perform public.receive_stock('20000000-0000-4000-8000-000000000033','10000000-0000-4000-8000-000000000031',1,29,8,12,'exact');
    raise exception 'Expected stock failure';
  exception when check_violation then null; end;
  if (select quantity from public.empty_crate_stock where crate_type='exact') <> 8 then raise exception 'Empty deduction did not roll back'; end if;
  if (select total_bottles from public.stock where product_id='10000000-0000-4000-8000-000000000031') <> 29 then raise exception 'Stock changed on failure'; end if;
end $$;
reset role;
drop trigger receiving_test_failure on public.stock;
-- Absent stock begins at zero only when a successful receiving operation is saved.
insert into public.empty_crate_stock values ('other',1);
set local role authenticated;
select public.receive_stock('20000000-0000-4000-8000-000000000034','10000000-0000-4000-8000-000000000032',1,0,1,24,'other');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000032',true);
do $$ begin
  begin
    perform public.receive_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000031',1,29,8,12,'exact');
    raise exception 'Non-owner authorized';
  exception when insufficient_privilege then null; end;
  begin
    perform private.receive_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000031',1,29,8,12,'exact');
    raise exception 'Private function bypassed owner check';
  exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
  begin
    perform public.receive_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000031',1,29,8,12,'exact');
    raise exception 'Anonymous authorized';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  if exists(select 1 from private.stock_receipts where request_id='20000000-0000-4000-8000-000000000033') then raise exception 'Failed receipt persisted'; end if;
  if (select total_bottles from public.stock where product_id='10000000-0000-4000-8000-000000000032') <> 24 then raise exception 'Initial receipt failed'; end if;
  if (select quantity from public.empty_crate_stock where crate_type='other') <> 0 then raise exception 'Empty crates did not reach zero'; end if;
end $$;
rollback;
