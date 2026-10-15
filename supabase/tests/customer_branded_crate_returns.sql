-- Disposable migrated database only. Nothing here reaches a real depot.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000001751');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000001751');
insert into public.crate_types(id,name,empty_family,pocket_count) values
 ('50000000-0000-4000-8000-000000001751','Gulder','NBL',12),
 ('50000000-0000-4000-8000-000000001752','Life','NBL',12),
 ('50000000-0000-4000-8000-000000001753','Goldberg','NBL',12),
 ('50000000-0000-4000-8000-000000001754','20 pocket','NBL',20);
insert into public.customers(id,name,phone) values
 ('20000000-0000-4000-8000-000000001751','Branded return test','08000001751');
insert into public.crate_obligations(customer_id,crate_type_id,crate_type,quantity) values
 ('20000000-0000-4000-8000-000000001751','50000000-0000-4000-8000-000000001751','Gulder',4);
create function pg_temp.assert_true(ok boolean, msg text) returns void
language plpgsql as $$ begin if ok is distinct from true then raise exception '%',msg; end if; end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000001751',true);
-- Directional compatibility; even a deliberately configured wrong-sized
-- replacement must still be rejected by the transaction.
select public.set_crate_swap_rules('50000000-0000-4000-8000-000000001751',
 array['50000000-0000-4000-8000-000000001752'::uuid,
       '50000000-0000-4000-8000-000000001754'::uuid]);

select public.record_customer_empty_return(
 '40000000-0000-4000-8000-000000001751',
 '20000000-0000-4000-8000-000000001751',
 '[{"crateTypeId":"50000000-0000-4000-8000-000000001751","returnedCrateTypeId":"50000000-0000-4000-8000-000000001752","quantity":2},
   {"crateTypeId":"50000000-0000-4000-8000-000000001751","quantity":1}]'::jsonb,
 '[]'::jsonb,'{}'::uuid[]);
select pg_temp.assert_true(
 (select quantity=1 from public.crate_obligations where crate_type_id='50000000-0000-4000-8000-000000001751'),
 'Original Gulder debt not reduced correctly');
select pg_temp.assert_true(
 (select quantity=2 from public.empty_crate_stock where crate_type_id='50000000-0000-4000-8000-000000001752'),
 'Physical Life crates not counted');
select pg_temp.assert_true(
 (select quantity=1 from public.empty_crate_stock where crate_type_id='50000000-0000-4000-8000-000000001751'),
 'Exact Gulder crate not counted');
select pg_temp.assert_true(
 (select count(*)=2 from public.empty_crate_stock),
 'Branded stock was merged or duplicated');

-- Retrying exactly the same request never counts returned stock twice.
select public.record_customer_empty_return(
 '40000000-0000-4000-8000-000000001751',
 '20000000-0000-4000-8000-000000001751',
 '[{"crateTypeId":"50000000-0000-4000-8000-000000001751","returnedCrateTypeId":"50000000-0000-4000-8000-000000001752","quantity":2},
   {"crateTypeId":"50000000-0000-4000-8000-000000001751","quantity":1}]'::jsonb,
 '[]'::jsonb,'{}'::uuid[]);
select pg_temp.assert_true(
 (select quantity=2 from public.empty_crate_stock where crate_type_id='50000000-0000-4000-8000-000000001752'),
 'Idempotent retry counted Life twice');
select pg_temp.assert_true(
 (select count(*)=1 from jsonb_array_elements(
   public.customer_return_record('40000000-0000-4000-8000-000000001751')->'crates') x
   where x->>'name'='Life' and x->>'owed_name'='Gulder' and x->>'quantity'='2'),
 'Return history did not preserve both owed and actual identities');

do $$
begin
  begin
    perform public.record_customer_empty_return(gen_random_uuid(),
      '20000000-0000-4000-8000-000000001751',
      '[{"crateTypeId":"50000000-0000-4000-8000-000000001751","returnedCrateTypeId":"50000000-0000-4000-8000-000000001753","quantity":1}]',
      '[]','{}');
    raise exception 'Unapproved same-pocket replacement accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_customer_empty_return(gen_random_uuid(),
      '20000000-0000-4000-8000-000000001751',
      '[{"crateTypeId":"50000000-0000-4000-8000-000000001751","returnedCrateTypeId":"50000000-0000-4000-8000-000000001754","quantity":1}]',
      '[]','{}');
    raise exception 'Wrong-sized configured replacement accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.record_customer_empty_return(gen_random_uuid(),
      '20000000-0000-4000-8000-000000001751',
      '[{"crateTypeId":"50000000-0000-4000-8000-000000001751","quantity":1},
        {"crateTypeId":"50000000-0000-4000-8000-000000001751","returnedCrateTypeId":"50000000-0000-4000-8000-000000001752","quantity":1}]',
      '[]','{}');
    raise exception 'Multiple physical types exceeded original owed balance';
  exception when invalid_parameter_value then null; end;
end $$;
select pg_temp.assert_true(
 (select quantity=1 from public.crate_obligations where crate_type_id='50000000-0000-4000-8000-000000001751'),
 'Failed return mutated debt');
select pg_temp.assert_true(
 (select count(*)=2 from public.empty_crate_stock),
 'Failed return mutated stock');
rollback;
