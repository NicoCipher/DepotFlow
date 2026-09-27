-- Disposable migrated database only. Every fixture and mutation rolls back.
begin;

insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000601'),
  ('00000000-0000-4000-8000-000000000602');
insert into private.shop_owner(user_id)
  values ('00000000-0000-4000-8000-000000000601');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000601',true);

select public.create_crate_type(
  '50000000-0000-4000-8000-000000000601','Goldberg','NBL',12,'regular'
);
select public.create_crate_type(
  '50000000-0000-4000-8000-000000000602','Trophy','International',12,'regular'
);
select public.create_crate_type(
  '50000000-0000-4000-8000-000000000603','Large','Other',20,'regular'
);

insert into public.products(
  id,name,bottles_per_crate,full_crate_price,bottles_returnable,bottle_type,crate_type_id
) values
(
  '10000000-0000-4000-8000-000000000601','Trophy Test',12,12000,true,'Trophy bottle',
  '50000000-0000-4000-8000-000000000602'
),
(
  '10000000-0000-4000-8000-000000000602','Large Test',20,20000,true,'Large bottle',
  '50000000-0000-4000-8000-000000000603'
);

insert into public.customers(id,name,phone) values
  ('20000000-0000-4000-8000-000000000601','Terms Test','+2348030000601'),
  ('20000000-0000-4000-8000-000000000602','Sack Test','+2348030000602');

reset role;
insert into public.stock(product_id,total_bottles) values
  ('10000000-0000-4000-8000-000000000601',120),
  ('10000000-0000-4000-8000-000000000602',200);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000601',true);

create function pg_temp.check_true(ok boolean,message text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception '%',message; end if;
end $$;

-- Customer terms still default to can-owe and remain owner-configurable.
select pg_temp.check_true(
  (select empties_deposit_required=false
   from public.customers where id='20000000-0000-4000-8000-000000000601'),
  'Customer empties terms did not default to can-owe'
);
update public.customers set empties_deposit_required=true
where id='20000000-0000-4000-8000-000000000601';
select pg_temp.check_true(
  (select empties_deposit_required
   from public.customers where id='20000000-0000-4000-8000-000000000601'),
  'Owner could not require an empties deposit'
);

-- Swap rules stay explicit and directional; deposit grouping does not imply swaps.
select public.set_crate_swap_rules(
  '50000000-0000-4000-8000-000000000601',
  array['50000000-0000-4000-8000-000000000602'::uuid]
);
select pg_temp.check_true(
  exists(
    select 1 from public.crate_swap_rules
    where owed_crate_type_id='50000000-0000-4000-8000-000000000601'
      and returned_crate_type_id='50000000-0000-4000-8000-000000000602'
  ),
  'Configured crate swap missing'
);
select pg_temp.check_true(
  not exists(
    select 1 from public.crate_swap_rules
    where owed_crate_type_id='50000000-0000-4000-8000-000000000602'
      and returned_crate_type_id='50000000-0000-4000-8000-000000000601'
  ),
  'Crate swap became symmetric without configuration'
);

-- One current bottle price applies business-wide, regardless of brand.
select public.set_bottle_deposit_price(200);
select pg_temp.check_true(
  (select count(*)=1 and max(amount)=200 from public.bottle_deposit_price),
  'Global bottle deposit price missing'
);

-- Complete-crate deposit is by pocket count, not crate identity/brand.
-- Crate-only can remain unknown until the business confirms it.
select public.set_crate_deposit_price(12,3000,null);
select public.set_crate_deposit_price(20,4500,1500);
select pg_temp.check_true(
  (select complete_crate_amount=3000 and crate_only_amount is null
   from public.crate_deposit_prices where pocket_count=12),
  '12-pocket complete-crate deposit missing'
);
select pg_temp.check_true(
  (select complete_crate_amount=4500 and crate_only_amount=1500
   from public.crate_deposit_prices where pocket_count=20),
  '20-pocket deposit rates missing'
);
select pg_temp.check_true(
  (select count(*)=2 from public.crate_deposit_prices),
  'Crate deposit was stored per brand instead of per pocket count'
);

do $$ begin
  begin
    perform public.set_crate_deposit_price(12,3025,null);
    raise exception 'Non-50-step complete crate price accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_crate_deposit_price(12,3000,0);
    raise exception 'Zero crate-only price accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_crate_deposit_price(24,5000,null);
    raise exception 'Unused pocket count accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_bottle_deposit_price(225);
    raise exception 'Non-50-step bottle price accepted';
  exception when invalid_parameter_value then null; end;
end $$;

-- One crate worth of drink can leave as bottles only (for example in a sack).
-- The sale quantity is still one crate, but zero physical crates leave.
do $$
declare
  line jsonb;
  result jsonb;
  v_sale_id uuid;
begin
  line:=jsonb_build_object(
    'productId','10000000-0000-4000-8000-000000000601',
    'quantity',jsonb_build_object('crates',1,'fraction',0,'bottles',0),
    'cratesTaken',0,
    'returnedCrates',0,
    'returnedBottles',12,
    'expected',jsonb_build_object(
      'full',12000,'half',null,'quarter',null,'bottle',null,
      'size',12,'crate','50000000-0000-4000-8000-000000000602',
      'returnable',true,'bottleType','Trophy bottle','stock',120
    )
  );
  result:=public.save_sale(
    '40000000-0000-4000-8000-000000000601',
    '20000000-0000-4000-8000-000000000602',
    '2026-09-27',
    12000,
    jsonb_build_array(line)
  );
  v_sale_id:=(result->>'id')::uuid;

  if not exists(
    select 1 from public.sale_items
    where sale_items.sale_id=v_sale_id
      and whole_crates=1
      and crates_out=0
      and total_bottles=12
      and bottles_returned=12
  ) then raise exception 'Bottles-only full-crate sale was not recorded correctly'; end if;

  if exists(
    select 1 from public.crate_obligations
    where customer_id='20000000-0000-4000-8000-000000000602'
  ) then raise exception 'Bottles-only sale incorrectly created a crate obligation'; end if;

  if exists(
    select 1 from public.bottle_obligations
    where customer_id='20000000-0000-4000-8000-000000000602'
  ) then raise exception 'Returned sack bottles incorrectly created a bottle obligation'; end if;

  if (select quantity from public.empty_bottle_stock where bottle_type='Trophy bottle')<>12 then
    raise exception 'Loose returned bottles did not enter empty-bottle stock'; end if;
end $$;

-- Existing callers that do not send cratesTaken retain the current default.
do $$
declare
  line jsonb;
  result jsonb;
  v_sale_id uuid;
begin
  line:=jsonb_build_object(
    'productId','10000000-0000-4000-8000-000000000602',
    'quantity',jsonb_build_object('crates',1,'fraction',0,'bottles',0),
    'returnedCrates',1,
    'returnedBottles',20,
    'expected',jsonb_build_object(
      'full',20000,'half',null,'quarter',null,'bottle',null,
      'size',20,'crate','50000000-0000-4000-8000-000000000603',
      'returnable',true,'bottleType','Large bottle','stock',200
    )
  );
  result:=public.save_sale(
    '40000000-0000-4000-8000-000000000602',
    '20000000-0000-4000-8000-000000000601',
    '2026-09-27',
    20000,
    jsonb_build_array(line)
  );
  v_sale_id:=(result->>'id')::uuid;
  if not exists(
    select 1 from public.sale_items
    where sale_items.sale_id=v_sale_id and whole_crates=1 and crates_out=1
  ) then raise exception 'Legacy sale caller no longer defaults crates out'; end if;
end $$;

-- Physical crates cannot exceed the whole-crate quantity sold.
do $$ begin
  begin
    perform public.save_sale(
      '40000000-0000-4000-8000-000000000603',
      '20000000-0000-4000-8000-000000000602',
      '2026-09-27',
      12000,
      jsonb_build_array(jsonb_build_object(
        'productId','10000000-0000-4000-8000-000000000601',
        'quantity',jsonb_build_object('crates',1,'fraction',0,'bottles',0),
        'cratesTaken',2,
        'returnedCrates',0,
        'returnedBottles',0,
        'expected',jsonb_build_object(
          'full',12000,'half',null,'quarter',null,'bottle',null,
          'size',12,'crate','50000000-0000-4000-8000-000000000602',
          'returnable',true,'bottleType','Trophy bottle','stock',108
        )
      ))
    );
    raise exception 'Too many physical crates were accepted';
  exception when invalid_parameter_value then null; end;
end $$;

-- Direct writes remain unavailable; non-owner and anon fail closed.
do $$ begin
  begin
    insert into public.crate_deposit_prices(pocket_count,complete_crate_amount)
    values(12,3500);
    raise exception 'Direct crate deposit write permitted';
  exception when insufficient_privilege then null; end;
  begin
    update public.bottle_deposit_price set amount=250 where id=1;
    raise exception 'Direct bottle deposit write permitted';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000602',true);
do $$ begin
  if exists(select 1 from public.crate_deposit_prices)
    or exists(select 1 from public.bottle_deposit_price)
    or exists(select 1 from public.crate_swap_rules) then
    raise exception 'Non-owner read empties configuration'; end if;
  begin
    perform public.set_crate_deposit_price(12,3000,null);
    raise exception 'Non-owner changed crate deposit';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_bottle_deposit_price(200);
    raise exception 'Non-owner changed bottle deposit';
  exception when insufficient_privilege then null; end;
end $$;

set local role anon;
do $$ begin
  begin
    perform * from public.bottle_deposit_price;
    raise exception 'Anonymous read bottle deposit';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select pg_temp.check_true(
  to_regclass('public.bottle_deposit_prices') is null,
  'Old per-bottle-type deposit table still exists'
);
select pg_temp.check_true(
  (select relrowsecurity from pg_class where oid='public.crate_deposit_prices'::regclass),
  'RLS missing on crate_deposit_prices'
);
select pg_temp.check_true(
  (select relrowsecurity from pg_class where oid='public.bottle_deposit_price'::regclass),
  'RLS missing on bottle_deposit_price'
);

rollback;
