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
  '50000000-0000-4000-8000-000000000603','33','NBL',12,'regular'
);

insert into public.products(
  id,name,bottles_per_crate,full_crate_price,bottles_returnable,bottle_type,crate_type_id
) values (
  '10000000-0000-4000-8000-000000000601','Goldberg Test',12,12000,true,'Goldberg bottle',
  '50000000-0000-4000-8000-000000000601'
);
insert into public.customers(id,name,phone) values
  ('20000000-0000-4000-8000-000000000601','Terms Test','+2348030000601');

create function pg_temp.check_true(ok boolean,message text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception '%',message; end if;
end $$;

-- Existing/new customers default to the current business behavior: they can owe empties.
select pg_temp.check_true(
  (select empties_deposit_required=false
   from public.customers where id='20000000-0000-4000-8000-000000000601'),
  'Customer empties terms did not default to can-owe'
);

update public.customers
set empties_deposit_required=true
where id='20000000-0000-4000-8000-000000000601';
select pg_temp.check_true(
  (select empties_deposit_required
   from public.customers where id='20000000-0000-4000-8000-000000000601'),
  'Owner could not require an empties deposit'
);

-- Swap rules are explicit and directional; family alone creates no rule.
select public.set_crate_swap_rules(
  '50000000-0000-4000-8000-000000000601',
  array[
    '50000000-0000-4000-8000-000000000602'::uuid,
    '50000000-0000-4000-8000-000000000602'::uuid
  ]
);
select pg_temp.check_true(
  (select count(*)=1 from public.crate_swap_rules
   where owed_crate_type_id='50000000-0000-4000-8000-000000000601'
     and returned_crate_type_id='50000000-0000-4000-8000-000000000602'),
  'Configured swap was not stored exactly once'
);
select pg_temp.check_true(
  not exists(
    select 1 from public.crate_swap_rules
    where owed_crate_type_id='50000000-0000-4000-8000-000000000602'
      and returned_crate_type_id='50000000-0000-4000-8000-000000000601'
  ),
  'Swap rule became symmetric without being configured'
);
select pg_temp.check_true(
  not exists(
    select 1 from public.crate_swap_rules
    where owed_crate_type_id='50000000-0000-4000-8000-000000000601'
      and returned_crate_type_id='50000000-0000-4000-8000-000000000603'
  ),
  'Shared metadata silently created a compatibility rule'
);

do $$ begin
  begin
    perform public.set_crate_swap_rules(
      '50000000-0000-4000-8000-000000000601',
      array['50000000-0000-4000-8000-000000000601'::uuid]
    );
    raise exception 'Self swap rule accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_crate_swap_rules(
      '50000000-0000-4000-8000-000000000601',
      array['99999999-0000-4000-8000-000000000999'::uuid]
    );
    raise exception 'Unknown crate swap accepted';
  exception when invalid_parameter_value then null; end;
end $$;

-- Current deposit prices are configurable and can be cleared.
select public.set_crate_deposit_price(
  '50000000-0000-4000-8000-000000000601',2500
);
select public.set_bottle_deposit_price('Goldberg bottle',200);
select pg_temp.check_true(
  (select amount=2500 from public.crate_deposit_prices
   where crate_type_id='50000000-0000-4000-8000-000000000601'),
  'Crate deposit price missing'
);
select pg_temp.check_true(
  (select amount=200 from public.bottle_deposit_prices
   where bottle_type='Goldberg bottle'),
  'Bottle deposit price missing'
);
select public.set_crate_deposit_price(
  '50000000-0000-4000-8000-000000000601',3000
);
select pg_temp.check_true(
  (select amount=3000 from public.crate_deposit_prices
   where crate_type_id='50000000-0000-4000-8000-000000000601'),
  'Crate deposit price update failed'
);

do $$ begin
  begin
    perform public.set_crate_deposit_price(
      '50000000-0000-4000-8000-000000000601',2525
    );
    raise exception 'Non-50-step crate price accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_bottle_deposit_price('Goldberg bottle',0);
    raise exception 'Zero bottle deposit accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_bottle_deposit_price('Unknown bottle',200);
    raise exception 'Unknown bottle type accepted';
  exception when invalid_parameter_value then null; end;
end $$;

select public.set_crate_deposit_price(
  '50000000-0000-4000-8000-000000000601',null
);
select public.set_bottle_deposit_price('Goldberg bottle',null);
select pg_temp.check_true(
  not exists(
    select 1 from public.crate_deposit_prices
    where crate_type_id='50000000-0000-4000-8000-000000000601'
  ),
  'Crate deposit price was not cleared'
);
select pg_temp.check_true(
  not exists(
    select 1 from public.bottle_deposit_prices
    where bottle_type='Goldberg bottle'
  ),
  'Bottle deposit price was not cleared'
);

-- Configuration tables remain read-only through the Data API.
do $$ begin
  begin
    insert into public.crate_swap_rules(owed_crate_type_id,returned_crate_type_id)
    values(
      '50000000-0000-4000-8000-000000000601',
      '50000000-0000-4000-8000-000000000603'
    );
    raise exception 'Direct swap write permitted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.crate_deposit_prices(crate_type_id,amount)
    values('50000000-0000-4000-8000-000000000601',2500);
    raise exception 'Direct crate price write permitted';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.bottle_deposit_prices(bottle_type,amount)
    values('Goldberg bottle',200);
    raise exception 'Direct bottle price write permitted';
  exception when insufficient_privilege then null; end;
end $$;

-- Restore one row so read-RLS can be checked for the non-owner.
select public.set_crate_swap_rules(
  '50000000-0000-4000-8000-000000000601',
  array['50000000-0000-4000-8000-000000000602'::uuid]
);
select public.set_crate_deposit_price(
  '50000000-0000-4000-8000-000000000601',2500
);
select public.set_bottle_deposit_price('Goldberg bottle',200);

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000602',true);
do $$ declare changed integer; begin
  if exists(select 1 from public.crate_swap_rules)
    or exists(select 1 from public.crate_deposit_prices)
    or exists(select 1 from public.bottle_deposit_prices) then
    raise exception 'Non-owner read empties configuration';
  end if;

  update public.customers
  set empties_deposit_required=false
  where id='20000000-0000-4000-8000-000000000601';
  get diagnostics changed=row_count;
  if changed<>0 then raise exception 'Non-owner changed customer empties terms'; end if;

  begin
    perform public.set_crate_swap_rules(
      '50000000-0000-4000-8000-000000000601','{}'::uuid[]
    );
    raise exception 'Non-owner changed swap rules';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_crate_deposit_price(
      '50000000-0000-4000-8000-000000000601',3000
    );
    raise exception 'Non-owner changed crate price';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_bottle_deposit_price('Goldberg bottle',250);
    raise exception 'Non-owner changed bottle price';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000601',true);
select pg_temp.check_true(
  (select empties_deposit_required
   from public.customers where id='20000000-0000-4000-8000-000000000601'),
  'Non-owner changed customer terms despite zero affected rows'
);
select pg_temp.check_true(
  (select amount=2500 from public.crate_deposit_prices
   where crate_type_id='50000000-0000-4000-8000-000000000601'),
  'Non-owner changed crate deposit price'
);
select pg_temp.check_true(
  (select amount=200 from public.bottle_deposit_prices
   where bottle_type='Goldberg bottle'),
  'Non-owner changed bottle deposit price'
);

set local role anon;
do $$ begin
  begin
    perform * from public.crate_swap_rules;
    raise exception 'Anonymous read swap rules';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_crate_swap_rules(
      '50000000-0000-4000-8000-000000000601','{}'::uuid[]
    );
    raise exception 'Anonymous changed swap rules';
  exception when insufficient_privilege then null; end;
  begin
    perform public.set_crate_deposit_price(
      '50000000-0000-4000-8000-000000000601',2500
    );
    raise exception 'Anonymous changed crate price';
  exception when insufficient_privilege then null; end;
end $$;

reset role;
select pg_temp.check_true(
  (select relrowsecurity from pg_class
   where oid='public.crate_swap_rules'::regclass),
  'RLS missing on crate_swap_rules'
);
select pg_temp.check_true(
  (select relrowsecurity from pg_class
   where oid='public.crate_deposit_prices'::regclass),
  'RLS missing on crate_deposit_prices'
);
select pg_temp.check_true(
  (select relrowsecurity from pg_class
   where oid='public.bottle_deposit_prices'::regclass),
  'RLS missing on bottle_deposit_prices'
);

rollback;
