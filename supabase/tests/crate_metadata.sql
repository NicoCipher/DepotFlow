-- Disposable migrated database only. Every fixture rolls back.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000081'),('00000000-0000-4000-8000-000000000082');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000081');
insert into public.crate_types(id,name,empty_family,pocket_count,is_legacy,legacy_key) values
('50000000-0000-4000-8000-000000000081','Regular','NBL',12,false,null),
('50000000-0000-4000-8000-000000000082','Another','NBL',12,false,null),
('50000000-0000-4000-8000-000000000083','NBL','NBL',null,true,'NBL');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000081',true);
insert into public.products(id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id) values
('10000000-0000-4000-8000-000000000081','33 Export',12,0,false,'50000000-0000-4000-8000-000000000081'),
('10000000-0000-4000-8000-000000000082','Goldberg',12,0,false,'50000000-0000-4000-8000-000000000081'),
('10000000-0000-4000-8000-000000000083','Unconfigured drink',20,0,false,'50000000-0000-4000-8000-000000000083');
select public.set_empty_crate_count('20000000-0000-4000-8000-000000000081','50000000-0000-4000-8000-000000000081',10,'2024-03-01',null);
select public.set_empty_crate_count('20000000-0000-4000-8000-000000000082','50000000-0000-4000-8000-000000000083',40,'2024-03-01',null);
select public.receive_stock('20000000-0000-4000-8000-000000000083','10000000-0000-4000-8000-000000000081',2,0,10,12,'50000000-0000-4000-8000-000000000081','2024-03-01');
reset role;
create temporary table original_rows as
 select 'products' as source,to_jsonb(p) as value from public.products p
 union all select 'empty_stock',to_jsonb(s) from public.empty_crate_stock s
 union all select 'empty_history',to_jsonb(m) from public.empty_crate_movements m
 union all select 'stock',to_jsonb(s) from public.stock s
 union all select 'stock_history',to_jsonb(m) from public.stock_movements m
 union all select 'retry',to_jsonb(r) from private.stock_receipts r;
create temporary table original_older_crates as select * from public.crate_types where is_legacy;
create temporary table original_identity as select id,created_at,legacy_key,is_legacy from public.crate_types;
set local role authenticated;
select public.edit_crate_type('50000000-0000-4000-8000-000000000081','33 Export crate','NBL',12,'Regular');
-- A repeated metadata save is a replacement of the same metadata, not a new ID.
select public.edit_crate_type('50000000-0000-4000-8000-000000000081','33 Export crate','NBL',12,'Regular');
do $$ begin
 if (select count(*) from public.products p join public.crate_types c on c.id=p.crate_type_id where c.name='33 Export crate')<>2 then raise exception 'Shared products did not see metadata edit'; end if;
 if (select count(*) from public.crate_types)<>3 then raise exception 'Metadata edit created identity'; end if;
 begin
  perform public.edit_crate_type('50000000-0000-4000-8000-000000000081','Wrong','NBL',20,'Short');
  raise exception 'Attached product mismatch allowed';
 exception when check_violation then null; end;
 begin
  update public.products set bottles_per_crate=20 where id='10000000-0000-4000-8000-000000000081';
  raise exception 'Product bottle mismatch allowed';
 exception when check_violation then null; end;
 begin
  update public.products set crate_type_id='50000000-0000-4000-8000-000000000082' where id='10000000-0000-4000-8000-000000000083';
  raise exception 'Assignment mismatch allowed';
 exception when check_violation then null; end;
 begin
  insert into public.products(name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id) values ('Wrong',20,0,false,'50000000-0000-4000-8000-000000000081');
  raise exception 'New product mismatch allowed';
 exception when check_violation then null; end;
 begin
  perform public.edit_crate_type('50000000-0000-4000-8000-000000000083','Wrong','NBL',12,'Regular');
  raise exception 'Older record edit allowed';
 exception when object_not_in_prerequisite_state then null; end;
 begin
  update public.empty_crate_stock set quantity=0;
  raise exception 'Direct empty write allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.stock set total_bottles=0;
  raise exception 'Direct stock write allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.crate_types set name='Bypass';
  raise exception 'Direct metadata write allowed';
 exception when insufficient_privilege then null; end;
end $$;
-- Even matching the attached product's capacity must never resolve an older balance.
do $$ begin
 begin
  perform public.edit_crate_type('50000000-0000-4000-8000-000000000083','33 Export crate','NBL',20,'Short');
  raise exception 'Older balance reinterpreted through matching metadata';
 exception when object_not_in_prerequisite_state then
  if sqlerrm <> 'This older crate record cannot be edited directly. Create an exact crate type and assign products to it instead.' then raise; end if;
 end;
end $$;
-- Receipt retry still returns its saved result after metadata changed.
select public.receive_stock('20000000-0000-4000-8000-000000000083','10000000-0000-4000-8000-000000000081',2,0,10,12,'50000000-0000-4000-8000-000000000081','2024-03-01');
reset role;
do $$ begin
 if exists((table original_older_crates) except (select * from public.crate_types where is_legacy)) then raise exception 'Older metadata changed'; end if;
 if exists((select * from original_identity) except (select id,created_at,legacy_key,is_legacy from public.crate_types)) then raise exception 'Identity or provenance changed'; end if;
 if exists ((select * from original_rows) except (
 select 'products',to_jsonb(p) from public.products p
 union all select 'empty_stock',to_jsonb(s) from public.empty_crate_stock s
 union all select 'empty_history',to_jsonb(m) from public.empty_crate_movements m
 union all select 'stock',to_jsonb(s) from public.stock s
 union all select 'stock_history',to_jsonb(m) from public.stock_movements m
 union all select 'retry',to_jsonb(r) from private.stock_receipts r
 )) then raise exception 'Metadata edit altered balances/history/products/retry records'; end if;
 if (select name from public.crate_types where id='50000000-0000-4000-8000-000000000081')<>'33 Export crate' then raise exception 'Failed edit partially applied'; end if;
end $$;
set local role authenticated;
do $$ declare n numeric; begin
 foreach n in array array[0,-1,1.5,null,'NaN'::numeric,'Infinity'::numeric,2147483648] loop
  begin
   perform public.edit_crate_type('50000000-0000-4000-8000-000000000081','Wrong','NBL',n,null);
   raise exception 'Invalid pocket accepted';
  exception when invalid_parameter_value then null; end;
 end loop;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000082',true);
do $$ begin
 if exists(select 1 from public.crate_types) then raise exception 'Non-owner read'; end if;
 begin
  perform public.edit_crate_type('50000000-0000-4000-8000-000000000081','Intruder','NBL',12,null);
  raise exception 'Non-owner edit';
 exception when insufficient_privilege then null; end;
 begin
  perform private.edit_crate_type('50000000-0000-4000-8000-000000000081','Intruder','NBL',12,null);
  raise exception 'Private authorization bypass';
 exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
 begin
  perform public.edit_crate_type('50000000-0000-4000-8000-000000000081','Intruder','NBL',12,null);
  raise exception 'Anonymous edit';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
