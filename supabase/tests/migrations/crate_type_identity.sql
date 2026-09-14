-- Run only on a disposable database with migrations through empty_crate_counts.
-- This tests the ACTUAL migration against populated legacy data, not a copy.
\set ON_ERROR_STOP on
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000061');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000061');
insert into public.products(id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type,empty_family) values
('10000000-0000-4000-8000-000000000061','33 Export',12,0,false,'NBL','NBL'),
('10000000-0000-4000-8000-000000000062','Goldberg',12,0,false,'NBL','NBL'),
('10000000-0000-4000-8000-000000000063','Castle Lite',12,0,false,'Trophy','Trophy'),
('10000000-0000-4000-8000-000000000064','Desperados',20,0,false,'Desperados','NBL');
insert into public.empty_crate_stock values ('NBL',31),('Trophy',17),('Desperados',8),('Orphan stock',6),(' NBL ',2);
insert into public.empty_crate_movements(crate_type,movement_type,previous_quantity,quantity_change,resulting_quantity,business_date,created_at,request_id)
values('NBL','count',null,31,31,'2024-02-29','2025-01-01','20000000-0000-4000-8000-000000000061');
-- Existing receiver retry and drink history have no recorded crate identity.
insert into private.stock_receipts values ('20000000-0000-4000-8000-000000000062','10000000-0000-4000-8000-000000000061',1,12,31,'2024-03-01');
insert into public.stock_movements(product_id,movement_type,quantity_change,resulting_stock,business_date,request_id,crates,loose_bottles,bottles_per_crate,product_name)
values('10000000-0000-4000-8000-000000000061','receive',12,12,'2024-03-01','20000000-0000-4000-8000-000000000062',1,0,12,'33 Export');
insert into public.customers(id,name,phone) values ('30000000-0000-4000-8000-000000000061','Migration fixture','08000000000');
insert into public.crate_obligations values ('30000000-0000-4000-8000-000000000061','History only',4);
insert into public.sales(id,customer_id,total_amount,paid_amount) values ('40000000-0000-4000-8000-000000000061','30000000-0000-4000-8000-000000000061',0,0);
insert into public.sale_items(sale_id,product_id,product_name,total_bottles,bottles_per_crate,line_total,bottles_returnable,crate_type)
values('40000000-0000-4000-8000-000000000061','10000000-0000-4000-8000-000000000061','33 Export',12,12,0,false,'Sale snapshot only');
create temporary table before_rows(table_name text,row_data jsonb);
do $$ declare t text; begin
  foreach t in array array['products','empty_crate_stock','empty_crate_movements','sale_items','crate_obligations','stock_movements'] loop
    execute format('insert into before_rows select %L,to_jsonb(r) from public.%I r',t,t);
  end loop;
  insert into before_rows select 'stock_receipts',to_jsonb(r) from private.stock_receipts r;
end $$;
\ir ../../migrations/20260913113337_crate_type_identity.sql

do $$ declare t text; ok boolean; begin
  -- Compare every original field, including IDs, dates, quantities and text.
  foreach t in array array['products','empty_crate_stock','empty_crate_movements','sale_items','crate_obligations','stock_movements','stock_receipts'] loop
    execute format('select not exists((select row_data from before_rows where table_name=%L except all select to_jsonb(r)-''crate_type_id'' from %I.%I r) union all (select to_jsonb(r)-''crate_type_id'' from %I.%I r except all select row_data from before_rows where table_name=%L))',t,case when t='stock_receipts' then 'private' else 'public' end,t,case when t='stock_receipts' then 'private' else 'public' end,t,t) into ok;
    if not ok then raise exception 'Migration changed original data in %',t; end if;
  end loop;
  if (select count(*) from public.crate_types) <> 7 then raise exception 'Legacy types merged/lost/seeded'; end if;
  foreach t in array array['products','empty_crate_stock','empty_crate_movements','sale_items','crate_obligations'] loop
    execute format('select not exists(select 1 from public.%I r left join public.crate_types c on c.id=r.crate_type_id where c.id is null or c.legacy_key is distinct from r.crate_type)',t) into ok;
    if not ok then raise exception 'Incorrect reference mapping in %',t; end if;
  end loop;
  if exists(select 1 from public.crate_types where legacy_key in ('NBL','Trophy') and (not is_legacy or pocket_count is not null)) then raise exception 'Legacy group falsely resolved'; end if;
  if not exists(select 1 from public.crate_types where legacy_key='Desperados' and empty_family='NBL' and pocket_count=20 and variant='short' and not is_legacy) then raise exception 'Confirmed attributes missing'; end if;
  if exists(select 1 from public.stock_movements where crate_type_id is not null) or exists(select 1 from private.stock_receipts where crate_type_id is not null) then raise exception 'Invented historical crate identity'; end if;
end $$;
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000061',false);
-- Legacy retry maps through migrated history; it must not create another count.
select public.set_empty_crate_count('20000000-0000-4000-8000-000000000061',(select id from public.crate_types where legacy_key='NBL'),31,'2024-02-29',null);
select public.receive_stock('20000000-0000-4000-8000-000000000062','10000000-0000-4000-8000-000000000061',1,0,32,12,(select id from public.crate_types where legacy_key='NBL'),'2024-03-01');
select public.create_crate_type('50000000-0000-4000-8000-000000000061','33 Export exact','NBL',12,'regular');
update public.products set crate_type_id='50000000-0000-4000-8000-000000000061' where id='10000000-0000-4000-8000-000000000061';
do $$ begin
  if (select quantity from public.empty_crate_stock where crate_type_id=(select id from public.crate_types where legacy_key='NBL')) <>31 then raise exception 'Reassignment moved legacy balance'; end if;
  if exists(select 1 from public.empty_crate_stock where crate_type_id='50000000-0000-4000-8000-000000000061') then raise exception 'Reassignment created/split a balance'; end if;
  if (select count(*) from public.empty_crate_movements)<>1 or (select crate_type_id from public.empty_crate_movements)<>(select id from public.crate_types where legacy_key='NBL') then raise exception 'Reassignment changed history'; end if;
  if (select crate_type_id from public.products where name='Goldberg')<>(select id from public.crate_types where legacy_key='NBL') then raise exception 'Reassignment changed another product'; end if;
end $$;
reset role;
