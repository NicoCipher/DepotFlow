-- Disposable acceptance for new-depot exact-crate stock receiving.
-- All owner grants/gates, stock and historical receipts are rolled back.
begin;

insert into auth.users(id) values
 ('89f00000-0000-4000-8000-000000000001'),
 ('89f00000-0000-4000-8000-000000000002'),
 ('89f00000-0000-4000-8000-000000000003');
insert into private.shop_owner(user_id)
 values('89f00000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
insert into public.crate_types(id,name,empty_family,pocket_count)
 values('89f00000-0000-4000-9000-000000000010','Legacy 12 crate','NB',12);
insert into public.products(
 id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id
) values(
 '89f00000-0000-4000-9000-000000000011','Legacy drink',12,10000,false,
 '89f00000-0000-4000-9000-000000000010'
);
insert into public.stock(product_id,total_bottles)
 values('89f00000-0000-4000-9000-000000000011',7);
insert into public.empty_crate_stock(crate_type_id,quantity)
 values('89f00000-0000-4000-9000-000000000010',3);

select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate$
declare r record;n int:=0;
begin
 for r in select ns.nspname s,c.relname t,k.conname
 from pg_constraint k
 join pg_class c on c.oid=k.conrelid
 join pg_namespace ns on ns.oid=c.relnamespace
 join private.legacy_scope_tables() tab
  on tab.schema_name=ns.nspname and tab.table_name=c.relname
 where k.contype='f' and left(k.conname,7)='tenant_'
 loop
  execute format('alter table %I.%I validate constraint %I',r.s,r.t,r.conname);
  n:=n+1;
 end loop;
 if n<>31 then raise exception 'Missing tenant foreign keys %',n;end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

insert into private.businesses(id,status) values
 ('89f00000-0000-4000-9000-000000000021','active'),
 ('89f00000-0000-4000-9000-000000000022','active');
insert into private.business_memberships(business_id,user_id,status,member_kind)
values
 ('89f00000-0000-4000-9000-000000000021',
  '89f00000-0000-4000-8000-000000000002','active','owner'),
 ('89f00000-0000-4000-9000-000000000022',
  '89f00000-0000-4000-8000-000000000003','active','owner');

-- Product/crate enrollment is still blocked in the application. These
-- values are disposable ADMIN fixture setup, not authorization bypasses
-- available to a new owner.
alter table public.crate_types disable trigger legacy_scope_business_write;
alter table public.products disable trigger legacy_scope_business_write;
alter table public.stock disable trigger legacy_scope_business_write;
alter table public.empty_crate_stock disable trigger legacy_scope_business_write;
insert into public.crate_types(id,name,empty_family,pocket_count,business_id)
values
 ('89f00000-0000-4000-9000-000000000031','A Heineken 12','NB',12,
  '89f00000-0000-4000-9000-000000000021'),
 ('89f00000-0000-4000-9000-000000000032','B Gulder 12','NB',12,
  '89f00000-0000-4000-9000-000000000022');
insert into public.products(
 id,name,bottles_per_crate,full_crate_price,bottles_returnable,
 crate_type_id,business_id
) values
 ('89f00000-0000-4000-9000-000000000041','A Heineken',12,12000,false,
  '89f00000-0000-4000-9000-000000000031',
  '89f00000-0000-4000-9000-000000000021'),
 ('89f00000-0000-4000-9000-000000000042','B Gulder',12,12000,false,
  '89f00000-0000-4000-9000-000000000032',
  '89f00000-0000-4000-9000-000000000022');
insert into public.stock(product_id,total_bottles,business_id)
values
 ('89f00000-0000-4000-9000-000000000041',24,
  '89f00000-0000-4000-9000-000000000021'),
 ('89f00000-0000-4000-9000-000000000042',50,
  '89f00000-0000-4000-9000-000000000022');
insert into public.empty_crate_stock(crate_type_id,crate_type,quantity,business_id)
values
 ('89f00000-0000-4000-9000-000000000031','A Heineken 12',5,
  '89f00000-0000-4000-9000-000000000021'),
 ('89f00000-0000-4000-9000-000000000032','B Gulder 12',4,
  '89f00000-0000-4000-9000-000000000022');
alter table public.empty_crate_stock enable trigger legacy_scope_business_write;
alter table public.stock enable trigger legacy_scope_business_write;
alter table public.products enable trigger legacy_scope_business_write;
alter table public.crate_types enable trigger legacy_scope_business_write;

-- Original shop operations must treat every foreign product/crate UUID
-- the SAME as an unknown UUID. SECURITY DEFINER cannot rely on RLS alone.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89f00000-0000-4000-8000-000000000001',true);
do $original_shop_metadata_isolation$
declare
  v_id uuid;
  v_message text;
begin
  foreach v_id in array array[
    '89f00000-0000-4000-9000-000000000042'::uuid,
    '89f00000-0000-4000-9000-000000000099'::uuid
  ] loop
    begin
      perform public.receive_stock(
        gen_random_uuid(),v_id,1,50,4,12,
        '89f00000-0000-4000-9000-000000000032','2026-10-18');
      raise exception 'Legacy receiving inspected foreign product'
        using errcode='PT001';
    exception when invalid_parameter_value then
      get stacked diagnostics v_message=message_text;
      if v_message<>'Product not found.' then
        raise exception 'Legacy receiving product oracle: %',v_message;
      end if;
    end;
    begin
      perform public.set_current_stock(
        gen_random_uuid(),v_id,2,0,'2026-10-18',50,12);
      raise exception 'Legacy count inspected foreign product'
        using errcode='PT001';
    exception when invalid_parameter_value then
      get stacked diagnostics v_message=message_text;
      if v_message<>'Product not found.' then
        raise exception 'Legacy stock count product oracle: %',v_message;
      end if;
    end;
  end loop;
  foreach v_id in array array[
    '89f00000-0000-4000-9000-000000000032'::uuid,
    '89f00000-0000-4000-9000-000000000098'::uuid
  ] loop
    begin
      perform public.set_empty_crate_count(
        gen_random_uuid(),v_id,4,'2026-10-18',4);
      raise exception 'Legacy count inspected foreign crate type'
        using errcode='PT001';
    exception when invalid_parameter_value then
      get stacked diagnostics v_message=message_text;
      if v_message<>'Choose an existing crate type.' then
        raise exception 'Legacy crate identity oracle: %',v_message;
      end if;
    end;
  end loop;
end;
$original_shop_metadata_isolation$;
reset role;

do $default_off$
begin
 if (select enabled from private.business_receiving_gate)
  or has_function_privilege('authenticated',
   'public.receive_business_stock(uuid,uuid,uuid,numeric,integer,integer,integer,uuid,date)',
   'EXECUTE')
  or has_function_privilege('anon',
   'public.receive_business_stock(uuid,uuid,uuid,numeric,integer,integer,integer,uuid,date)',
   'EXECUTE') then
  raise exception 'Receiving unexpectedly enabled for customer accounts';
 end if;
end;
$default_off$;
grant execute on function public.receive_business_stock(
 uuid,uuid,uuid,numeric,integer,integer,integer,uuid,date
) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89f00000-0000-4000-8000-000000000002',true);
do $gate_denied$
begin
 begin
  perform public.receive_business_stock(
   '89f00000-0000-4000-9000-000000000021',
   '89f00000-0000-4000-9000-000000000101',
   '89f00000-0000-4000-9000-000000000041',
   2,24,5,12,'89f00000-0000-4000-9000-000000000031',
   '2026-10-18');
  raise exception 'Owner received while receiving gate disabled'
   using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$gate_denied$;
reset role;

update private.business_receiving_gate set enabled=true where singleton;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89f00000-0000-4000-8000-000000000002',true);
do $first_owners$
declare first jsonb;second jsonb;
begin
 first:=public.receive_business_stock(
   '89f00000-0000-4000-9000-000000000021',
   '89f00000-0000-4000-9000-000000000101',
   '89f00000-0000-4000-9000-000000000041',
   2,24,5,12,'89f00000-0000-4000-9000-000000000031',
   '2026-10-18');
 if (first->>'stock_after')::int<>48
   or (first->>'empties_after')::int<>3 then
  raise exception 'A receiving did not add 24 bottles and consume 2 crates: %',first;
 end if;
 second:=public.receive_business_stock(
   '89f00000-0000-4000-9000-000000000021',
   '89f00000-0000-4000-9000-000000000101',
   '89f00000-0000-4000-9000-000000000041',
   2,24,5,12,'89f00000-0000-4000-9000-000000000031',
   '2026-10-18');
 if second is distinct from first then
  raise exception 'Original receiving replay changed receipt: %',second;
 end if;
 if (select count(*) from public.stock_movements)<>1 then
  raise exception 'A must see exactly one of its own stock movements';
 end if;
 begin
  perform public.receive_business_stock(
   '89f00000-0000-4000-9000-000000000021',
   '89f00000-0000-4000-9000-000000000102',
   '89f00000-0000-4000-9000-000000000042',
   1,50,4,12,'89f00000-0000-4000-9000-000000000032',
   '2026-10-18');
  raise exception 'Owner A received B business product' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.receive_business_stock(
   '89f00000-0000-4000-9000-000000000021',
   '89f00000-0000-4000-9000-000000000102',
   '89f00000-0000-4000-9000-000000000041',
   1,48,3,12,'89f00000-0000-4000-9000-000000000032',
   '2026-10-18');
  raise exception 'Owner A swapped a Gulder crate for Heineken'
   using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
end;
$first_owners$;
reset role;

-- Cross-operation request reuse must fail in BOTH directions. The first
-- receiving already committed in this disposable transaction (request 101).
-- Enable the independently gated count RPC only inside this savepoint.
savepoint two_operation_request_namespace;
grant execute on function public.count_business_product_stock(
 uuid,uuid,uuid,numeric,numeric,integer,integer,date
) to authenticated;
update private.business_product_stock_count_gate
 set enabled=true where singleton;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89f00000-0000-4000-8000-000000000002',true);
do $count_and_receive_are_distinct$
declare
  v_result jsonb;
begin
  -- RECEIVING committed first. A same-request stock count must reject
  -- even if the requested quantity is unchanged.
  begin
    perform public.count_business_product_stock(
      '89f00000-0000-4000-9000-000000000021',
      '89f00000-0000-4000-9000-000000000101',
      '89f00000-0000-4000-9000-000000000041',
      4,0,48,12,'2026-10-18');
    raise exception 'Receiving request was reused by stock count'
      using errcode='PT001';
  exception when invalid_parameter_value then null;
  end;

  -- COUNT committed first. Receiving with the same UUID must also reject
  -- before deducting any empty crates or making a movement/receipt.
  v_result:=public.count_business_product_stock(
    '89f00000-0000-4000-9000-000000000021',
    '89f00000-0000-4000-9000-000000000106',
    '89f00000-0000-4000-9000-000000000041',
    4,0,48,12,'2026-10-18');
  if (v_result->>'total')::int<>48 then
    raise exception 'Test setup count changed stock unexpectedly';
  end if;
  begin
    perform public.receive_business_stock(
      '89f00000-0000-4000-9000-000000000021',
      '89f00000-0000-4000-9000-000000000106',
      '89f00000-0000-4000-9000-000000000041',
      1,48,3,12,'89f00000-0000-4000-9000-000000000031',
      '2026-10-18');
    raise exception 'Stock count request was reused by receiving'
      using errcode='PT001';
  exception when invalid_parameter_value then null;
  end;
end;
$count_and_receive_are_distinct$;
reset role;
rollback to savepoint two_operation_request_namespace;
release savepoint two_operation_request_namespace;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89f00000-0000-4000-8000-000000000003',true);
do $second_owner$
declare result jsonb;
begin
 -- SAME request UUID as business A is fully independent.
 result:=public.receive_business_stock(
   '89f00000-0000-4000-9000-000000000022',
   '89f00000-0000-4000-9000-000000000101',
   '89f00000-0000-4000-9000-000000000042',
   1,50,4,12,'89f00000-0000-4000-9000-000000000032',
   '2026-10-18');
 if (result->>'stock_after')::int<>62
    or (result->>'empties_after')::int<>3 then
  raise exception 'B receiving leaked or used A stock: %',result;
 end if;
end;
$second_owner$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89f00000-0000-4000-8000-000000000002',true);
do $invalid_retries$
begin
 begin
  perform public.receive_business_stock(
   '89f00000-0000-4000-9000-000000000021',
   '89f00000-0000-4000-9000-000000000103',
   '89f00000-0000-4000-9000-000000000041',
   1,24,3,12,'89f00000-0000-4000-9000-000000000031',
   '2026-10-18');
  raise exception 'Stale product stock 24 overwrote current 48'
   using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.receive_business_stock(
   '89f00000-0000-4000-9000-000000000021',
   '89f00000-0000-4000-9000-000000000104',
   '89f00000-0000-4000-9000-000000000041',
   4,48,3,12,'89f00000-0000-4000-9000-000000000031',
   '2026-10-18');
  raise exception 'Insufficient exact empty crates were consumed'
   using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.receive_business_stock(
   '89f00000-0000-4000-9000-000000000021',
   '89f00000-0000-4000-9000-000000000101',
   '89f00000-0000-4000-9000-000000000041',
   1,24,5,12,'89f00000-0000-4000-9000-000000000031',
   '2026-10-18');
  raise exception 'Same request ID with changed crates was accepted'
   using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
end;
$invalid_retries$;
reset role;

do $compare_balances_and_events$
begin
 if (select total_bottles from public.stock
     where product_id='89f00000-0000-4000-9000-000000000011')<>7
  or (select quantity from public.empty_crate_stock
     where crate_type_id='89f00000-0000-4000-9000-000000000010')<>3
  or (select total_bottles from public.stock
     where product_id='89f00000-0000-4000-9000-000000000041')<>48
  or (select quantity from public.empty_crate_stock
     where crate_type_id='89f00000-0000-4000-9000-000000000031')<>3
  or (select total_bottles from public.stock
     where product_id='89f00000-0000-4000-9000-000000000042')<>62
  or (select quantity from public.empty_crate_stock
     where crate_type_id='89f00000-0000-4000-9000-000000000032')<>3
  or (select count(*) from private.business_receiving_requests)<>2
  or (select count(*) from private.stock_receipts where
     request_id='89f00000-0000-4000-9000-000000000101')<>2
  or (select count(*) from public.stock_movements where
     request_id='89f00000-0000-4000-9000-000000000101'
     and movement_type='receive')<>2
  or (select sum(quantity_change) from public.stock_movements)<>36 then
  raise exception 'Legacy/A/B receiving balances or receipt audit are inconsistent';
 end if;
end;
$compare_balances_and_events$;

-- Simulate an HTTP response lost after receiving committed, then a
-- subsequent product deactivation. Historical exact replay must be returned
-- unchanged without touching crates, stock or movements.
savepoint replay_after_receiving_product_change;
alter table public.products disable trigger legacy_scope_business_write;
update public.products set is_active=false
 where id='89f00000-0000-4000-9000-000000000041';
alter table public.products enable trigger legacy_scope_business_write;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89f00000-0000-4000-8000-000000000002',true);
do $retry_after_deactivation$
declare v jsonb;
begin
 v:=public.receive_business_stock(
   '89f00000-0000-4000-9000-000000000021',
   '89f00000-0000-4000-9000-000000000101',
   '89f00000-0000-4000-9000-000000000041',
   2,24,5,12,'89f00000-0000-4000-9000-000000000031',
   '2026-10-18');
 if (v->>'stock_after')::int<>48 or (v->>'empties_after')::int<>3 then
   raise exception 'Post-deactivation receiving retry lost original receipt: %',v;
 end if;
 begin
  perform public.receive_business_stock(
   '89f00000-0000-4000-9000-000000000021',
   '89f00000-0000-4000-9000-000000000111',
   '89f00000-0000-4000-9000-000000000041',
   1,48,3,12,'89f00000-0000-4000-9000-000000000031',
   '2026-10-18');
  raise exception 'New receiving accepted deactivated product' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
end;
$retry_after_deactivation$;
reset role;
rollback to savepoint replay_after_receiving_product_change;
release savepoint replay_after_receiving_product_change;

update private.business_memberships set status='disabled'
 where business_id='89f00000-0000-4000-9000-000000000022';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89f00000-0000-4000-8000-000000000003',true);
do $revoked$
begin
 begin
  perform public.receive_business_stock(
   '89f00000-0000-4000-9000-000000000022',
   '89f00000-0000-4000-9000-000000000101',
   '89f00000-0000-4000-9000-000000000042',
   1,50,4,12,'89f00000-0000-4000-9000-000000000032',
   '2026-10-18');
  raise exception 'Revoked B owner replayed receiving request'
   using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 if exists(select 1 from public.stock_movements)
   or exists(select 1 from public.stock) then
  raise exception 'Revoked owner can still read protected stock activity';
 end if;
end;
$revoked$;
reset role;

rollback;
