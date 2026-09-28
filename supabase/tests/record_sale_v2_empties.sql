-- Factual empties save path. All fixtures roll back.
begin;

insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000701'),
  ('00000000-0000-4000-8000-000000000702');
insert into private.shop_owner(user_id)
  values ('00000000-0000-4000-8000-000000000701');

insert into public.crate_types(id,name,empty_family,pocket_count) values
  ('50000000-0000-4000-8000-000000000701','Goldberg','NBL',12),
  ('50000000-0000-4000-8000-000000000702','Trophy','International',12);

insert into public.products(
  id,name,bottles_per_crate,full_crate_price,half_crate_price,quarter_crate_price,
  bottle_price,bottles_returnable,bottle_type,crate_type_id
) values
  ('10000000-0000-4000-8000-000000000701','Goldberg Test',12,12000,6000,3000,1000,true,'Goldberg bottle','50000000-0000-4000-8000-000000000701'),
  ('10000000-0000-4000-8000-000000000702','Trophy Test',12,12000,6000,3000,1000,true,'Trophy bottle','50000000-0000-4000-8000-000000000702');

insert into public.stock(product_id,total_bottles) values
  ('10000000-0000-4000-8000-000000000701',120),
  ('10000000-0000-4000-8000-000000000702',120);

insert into public.customers(id,name,phone,empties_deposit_required) values
  ('20000000-0000-4000-8000-000000000701','Can owe','08000000701',false),
  ('20000000-0000-4000-8000-000000000702','Deposit customer','08000000702',true);

create function pg_temp.check_true(ok boolean,message text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception '%',message; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000701',true);

-- A crate-worth sold in a sack: 12 bottles leave, zero physical crates leave.
do $$
declare result jsonb; sid uuid; line jsonb;
begin
  line:=jsonb_build_object(
    'productId','10000000-0000-4000-8000-000000000702',
    'quantity',jsonb_build_object('crates',1,'fraction',0,'bottles',0),
    'cratesTaken',0,'returnedCrates',0,'returnedBottles',12,
    'expected',jsonb_build_object(
      'full',12000,'half',6000,'quarter',3000,'bottle',1000,'size',12,
      'crate','50000000-0000-4000-8000-000000000702',
      'returnable',true,'bottleType','Trophy bottle','stock',120
    )
  );
  result:=public.save_sale_v2(
    '40000000-0000-4000-8000-000000000701',
    '20000000-0000-4000-8000-000000000701',
    '2026-09-27',12000,jsonb_build_array(line),'[]'::jsonb,
    '[{"bottleType":"Trophy bottle","quantity":12}]'::jsonb
  );
  sid:=(result->>'id')::uuid;
  if not exists(
    select 1 from public.sale_items
    where sale_id=sid and whole_crates=1 and crates_out=0
      and crates_returned=0 and bottles_returned=12
  ) then raise exception 'Sack sale packaging facts were not stored'; end if;
  if exists(
    select 1 from public.crate_obligations
    where customer_id='20000000-0000-4000-8000-000000000701'
  ) then raise exception 'Sack sale created a crate obligation'; end if;
end $$;

-- A complete Trophy package may be recorded physically while settling Goldberg.
-- Matching rules are resolved by the application; the DB keeps expected settlement
-- separate from the actual stock that came back.
do $$
declare result jsonb; sid uuid; line jsonb;
begin
  line:=jsonb_build_object(
    'productId','10000000-0000-4000-8000-000000000701',
    'quantity',jsonb_build_object('crates',1,'fraction',0,'bottles',0),
    'cratesTaken',1,'returnedCrates',1,'returnedBottles',12,
    'expected',jsonb_build_object(
      'full',12000,'half',6000,'quarter',3000,'bottle',1000,'size',12,
      'crate','50000000-0000-4000-8000-000000000701',
      'returnable',true,'bottleType','Goldberg bottle','stock',120
    )
  );
  result:=public.save_sale_v2(
    '40000000-0000-4000-8000-000000000702',
    '20000000-0000-4000-8000-000000000701',
    '2026-09-27',12000,jsonb_build_array(line),
    '[{"crateTypeId":"50000000-0000-4000-8000-000000000702","quantity":1}]'::jsonb,
    '[{"bottleType":"Trophy bottle","quantity":12}]'::jsonb
  );
  sid:=(result->>'id')::uuid;
  if not exists(
    select 1 from public.sale_empty_crate_returns
    where sale_id=sid and crate_type_id='50000000-0000-4000-8000-000000000702' and quantity=1
  ) then raise exception 'Actual swapped crate was not preserved'; end if;
  if not exists(
    select 1 from public.sale_empty_bottle_returns
    where sale_id=sid and bottle_type='Trophy bottle' and quantity=12
  ) then raise exception 'Actual swapped bottles were not preserved'; end if;
  if exists(
    select 1 from public.crate_obligations
    where customer_id='20000000-0000-4000-8000-000000000701'
      and crate_type_id='50000000-0000-4000-8000-000000000701'
  ) then raise exception 'Resolved swap still created a Goldberg crate obligation'; end if;
end $$;

-- Retrying the same request after an uncertain client response is idempotent.
-- The second call must return the original sale and must not deduct stock twice.
do $retry$
declare
  first_result jsonb;
  retry_result jsonb;
  sid uuid;
  line jsonb;
  stock_before integer;
  stock_after integer;
begin
  select total_bottles into stock_before
  from public.stock
  where product_id='10000000-0000-4000-8000-000000000701';

  line:=jsonb_build_object(
    'productId','10000000-0000-4000-8000-000000000701',
    'quantity',jsonb_build_object('crates',1,'fraction',0,'bottles',0),
    'cratesTaken',1,'returnedCrates',1,'returnedBottles',12,
    'expected',jsonb_build_object(
      'full',12000,'half',6000,'quarter',3000,'bottle',1000,'size',12,
      'crate','50000000-0000-4000-8000-000000000701',
      'returnable',true,'bottleType','Goldberg bottle','stock',stock_before
    )
  );

  first_result:=public.save_sale_v2(
    '40000000-0000-4000-8000-000000000706',
    '20000000-0000-4000-8000-000000000701',
    '2026-09-27',12000,jsonb_build_array(line),
    '[{"crateTypeId":"50000000-0000-4000-8000-000000000701","quantity":1}]'::jsonb,
    '[{"bottleType":"Goldberg bottle","quantity":12}]'::jsonb
  );

  retry_result:=public.save_sale_v2(
    '40000000-0000-4000-8000-000000000706',
    '20000000-0000-4000-8000-000000000701',
    '2026-09-27',12000,jsonb_build_array(line),
    '[{"crateTypeId":"50000000-0000-4000-8000-000000000701","quantity":1}]'::jsonb,
    '[{"bottleType":"Goldberg bottle","quantity":12}]'::jsonb
  );

  sid:=(first_result->>'id')::uuid;
  if (retry_result->>'id')::uuid is distinct from sid then
    raise exception 'Idempotent retry returned a different sale';
  end if;

  if (select count(*) from public.sales where request_id='40000000-0000-4000-8000-000000000706') <> 1 then
    raise exception 'Idempotent retry created a duplicate sale';
  end if;

  select total_bottles into stock_after
  from public.stock
  where product_id='10000000-0000-4000-8000-000000000701';

  if stock_after <> stock_before - 12 then
    raise exception 'Idempotent retry deducted stock more than once';
  end if;
end $retry$;

-- Exact crate, two wrong/missing bottles: crate settles, only 10 Trophy bottles settle.
do $$
declare result jsonb; line jsonb;
begin
  line:=jsonb_build_object(
    'productId','10000000-0000-4000-8000-000000000702',
    'quantity',jsonb_build_object('crates',1,'fraction',0,'bottles',0),
    'cratesTaken',1,'returnedCrates',1,'returnedBottles',10,
    'expected',jsonb_build_object(
      'full',12000,'half',6000,'quarter',3000,'bottle',1000,'size',12,
      'crate','50000000-0000-4000-8000-000000000702',
      'returnable',true,'bottleType','Trophy bottle','stock',108
    )
  );
  result:=public.save_sale_v2(
    '40000000-0000-4000-8000-000000000703',
    '20000000-0000-4000-8000-000000000701',
    '2026-09-27',12000,jsonb_build_array(line),
    '[{"crateTypeId":"50000000-0000-4000-8000-000000000702","quantity":1}]'::jsonb,
    '[{"bottleType":"Trophy bottle","quantity":10},{"bottleType":"Goldberg bottle","quantity":2}]'::jsonb
  );
  if not exists(
    select 1 from public.bottle_obligations
    where customer_id='20000000-0000-4000-8000-000000000701'
      and bottle_type='Trophy bottle' and quantity=2
  ) then raise exception 'Missing Trophy bottles were not owed'; end if;
end $$;

-- Deposit-required customers cannot silently fall back to owing.
do $$ declare line jsonb; begin
  line:=jsonb_build_object(
    'productId','10000000-0000-4000-8000-000000000701',
    'quantity',jsonb_build_object('crates',1,'fraction',0,'bottles',0),
    'cratesTaken',1,'returnedCrates',0,'returnedBottles',0,
    'expected',jsonb_build_object(
      'full',12000,'half',6000,'quarter',3000,'bottle',1000,'size',12,
      'crate','50000000-0000-4000-8000-000000000701',
      'returnable',true,'bottleType','Goldberg bottle','stock',108
    )
  );
  begin
    perform public.save_sale_v2(
      '40000000-0000-4000-8000-000000000704',
      '20000000-0000-4000-8000-000000000702',
      '2026-09-27',12000,jsonb_build_array(line),'[]'::jsonb,'[]'::jsonb
    );
    raise exception 'Deposit-required shortage was saved without a deposit';
  exception when invalid_parameter_value then null; end;
end $$;

-- A non-owner cannot use the RPC.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000702',true);
do $$ begin
  begin
    perform public.save_sale_v2(
      '40000000-0000-4000-8000-000000000705',
      '20000000-0000-4000-8000-000000000701',
      '2026-09-27',0,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb
    );
    raise exception 'Non-owner saved a sale';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select pg_temp.check_true(
  (select relrowsecurity from pg_class where oid='public.sale_empty_crate_returns'::regclass),
  'RLS missing on sale_empty_crate_returns'
);
select pg_temp.check_true(
  (select relrowsecurity from pg_class where oid='public.sale_empty_bottle_returns'::regclass),
  'RLS missing on sale_empty_bottle_returns'
);

rollback;
