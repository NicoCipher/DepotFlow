-- Disposable migrated database only; all fixtures roll back.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000071'),('00000000-0000-4000-8000-000000000072');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000071');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000071',true);
-- Identical attributes AND names still represent two explicit identities.
select public.create_crate_type('50000000-0000-4000-8000-000000000071','Regular','NBL',12,'regular');
select public.create_crate_type('50000000-0000-4000-8000-000000000072','Regular','NBL',12,'regular');
select public.create_crate_type('50000000-0000-4000-8000-000000000073','Short','NBL',20,'short');
select public.create_crate_type('50000000-0000-4000-8000-000000000074','Other','NBL',18,null);
select public.create_crate_type('50000000-0000-4000-8000-000000000071','Regular','NBL',12,'regular');
do $$ declare n numeric; begin
  if (select count(*) from public.crate_types)<>4 then raise exception 'Merged attributes or duplicated retry'; end if;
  foreach n in array array[0,-1,1.5,null,'NaN'::numeric,'Infinity'::numeric,2147483648] loop
    begin
      perform public.create_crate_type(gen_random_uuid(),'Invalid','NBL',n,null);
      raise exception 'Invalid capacity accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    perform public.create_crate_type('50000000-0000-4000-8000-000000000071','Changed','NBL',12,'regular');
    raise exception 'Changed retry accepted';
  exception when invalid_parameter_value then null; end;
  begin
    update public.crate_types set id=gen_random_uuid();
    raise exception 'Direct crate identity update granted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.crate_types(name,empty_family,pocket_count) values('Direct','NBL',12);
    raise exception 'Direct crate insertion granted';
  exception when insufficient_privilege then null; end;
end $$;
insert into public.products(id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id) values
('10000000-0000-4000-8000-000000000071','Drink one',12,0,false,'50000000-0000-4000-8000-000000000071'),
('10000000-0000-4000-8000-000000000072','Drink two',12,0,false,'50000000-0000-4000-8000-000000000071'),
('10000000-0000-4000-8000-000000000073','Drink three',12,0,false,'50000000-0000-4000-8000-000000000072');
select public.set_empty_crate_count('20000000-0000-4000-8000-000000000071','50000000-0000-4000-8000-000000000071',10,'2024-03-01',null);
select public.set_empty_crate_count('20000000-0000-4000-8000-000000000072','50000000-0000-4000-8000-000000000072',7,'2024-03-01',null);
select public.receive_stock('20000000-0000-4000-8000-000000000073','10000000-0000-4000-8000-000000000071',2,0,10,12,'50000000-0000-4000-8000-000000000071','2024-03-01');
do $$ begin
  if (select quantity from public.empty_crate_stock where crate_type_id='50000000-0000-4000-8000-000000000071')<>8 then raise exception 'Wrong selected crate deduction'; end if;
  if (select quantity from public.empty_crate_stock where crate_type_id='50000000-0000-4000-8000-000000000072')<>7 then raise exception 'Matching attributes caused substitution'; end if;
  if (select count(*) from public.products where crate_type_id='50000000-0000-4000-8000-000000000071')<>2 then raise exception 'Explicit sharing rejected'; end if;
  if (select crate_type_id from public.stock_movements where request_id='20000000-0000-4000-8000-000000000073')<>'50000000-0000-4000-8000-000000000071' then raise exception 'New history identity missing'; end if;
  begin
    update public.products set crate_type='NBL';
    raise exception 'Legacy text operational write allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.products set crate_type_id=gen_random_uuid();
    raise exception 'Unknown crate FK accepted';
  exception when foreign_key_violation then null; end;
end $$;
-- Reassignment cannot alter either independent empty-crate balance or old history.
update public.products set crate_type_id='50000000-0000-4000-8000-000000000072' where id='10000000-0000-4000-8000-000000000071';
select public.receive_stock('20000000-0000-4000-8000-000000000073','10000000-0000-4000-8000-000000000071',2,0,10,12,'50000000-0000-4000-8000-000000000071','2024-03-01');
do $$ begin
  if (select quantity from public.empty_crate_stock where crate_type_id='50000000-0000-4000-8000-000000000071')<>8 or (select quantity from public.empty_crate_stock where crate_type_id='50000000-0000-4000-8000-000000000072')<>7 then raise exception 'Reassignment/retry moved balance'; end if;
  begin
    perform public.receive_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000071',1,24,7,12,'50000000-0000-4000-8000-000000000071','2024-03-02');
    raise exception 'Stale crate identity accepted';
  exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000072',true);
do $$ begin
  if exists(select 1 from public.crate_types) then raise exception 'Non-owner read'; end if;
  begin
    perform public.create_crate_type(gen_random_uuid(),'Intruder','NBL',12,null);
    raise exception 'Non-owner create';
  exception when insufficient_privilege then null; end;
  begin
    perform private.create_crate_type(gen_random_uuid(),'Intruder','NBL',12,null);
    raise exception 'Private function bypass';
  exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
  begin
    perform public.create_crate_type(gen_random_uuid(),'Intruder','NBL',12,null);
    raise exception 'Anonymous create';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
  begin
    update public.crate_types set id=gen_random_uuid() where id='50000000-0000-4000-8000-000000000074';
    raise exception 'Immutable ID changed';
  exception when invalid_parameter_value then null; end;
end $$;
rollback;
