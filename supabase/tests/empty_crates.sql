-- Disposable migrated database only; all fixtures and failure triggers roll back.
begin;
insert into public.crate_types(id,name,empty_family,pocket_count) values
 ('4c55883b-dc3c-53ef-9b95-263f09309b09','exact A','same family',12),
 ('58c73e9e-8b2d-5bae-97ef-fe8ae17f4aa8','exact B','same family',24),
 ('8a992f33-42e3-51b8-912a-c9353a68d1f8','existing / type','same family',12);
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000051'),('00000000-0000-4000-8000-000000000052');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000051');
insert into public.products(id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id,empty_family) values
 ('10000000-0000-4000-8000-000000000051','Exact A',12,0,false,'4c55883b-dc3c-53ef-9b95-263f09309b09','same family'),
 ('10000000-0000-4000-8000-000000000052','Exact B',24,0,false,'58c73e9e-8b2d-5bae-97ef-fe8ae17f4aa8','same family'),
 ('10000000-0000-4000-8000-000000000053','Another A',12,0,false,'4c55883b-dc3c-53ef-9b95-263f09309b09','same family');
insert into public.empty_crate_stock(crate_type_id,quantity) values ('8a992f33-42e3-51b8-912a-c9353a68d1f8',3);
create function pg_temp.check_empty(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception '%',message; end if; end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000051',true);
select pg_temp.check_empty((select count(*)=3 from public.known_empty_crates),'Known types lost, duplicated or merged by family');
select pg_temp.check_empty((select quantity is null from public.known_empty_crates where crate_type_id='4c55883b-dc3c-53ef-9b95-263f09309b09'),'Unrecorded incorrectly zero');
select pg_temp.check_empty((select quantity=3 from public.known_empty_crates where crate_type_id='8a992f33-42e3-51b8-912a-c9353a68d1f8'),'Stock-only type missing');
select public.set_empty_crate_count('20000000-0000-4000-8000-000000000051','4c55883b-dc3c-53ef-9b95-263f09309b09',13,'2024-02-29',null);
select public.set_empty_crate_count('20000000-0000-4000-8000-000000000051','4c55883b-dc3c-53ef-9b95-263f09309b09',13,'2024-02-29',null);
select pg_temp.check_empty((select quantity=13 from public.empty_crate_stock where crate_type_id='4c55883b-dc3c-53ef-9b95-263f09309b09'),'Positive count failed');
select pg_temp.check_empty((select count(*)=1 from public.empty_crate_movements),'Retry duplicated history');
select pg_temp.check_empty((select movement_type='count' and previous_quantity is null and quantity_change=13 and resulting_quantity=13 and business_date='2024-02-29' and created_at::date <> business_date from public.empty_crate_movements),'Initial history wrong');
select public.set_empty_crate_count('20000000-0000-4000-8000-000000000052','4c55883b-dc3c-53ef-9b95-263f09309b09',5,'2024-03-01',13);
select pg_temp.check_empty((select quantity=5 from public.empty_crate_stock where crate_type_id='4c55883b-dc3c-53ef-9b95-263f09309b09'),'Count added instead of replaced');
select pg_temp.check_empty((select previous_quantity=13 and quantity_change=-8 and resulting_quantity=5 from public.empty_crate_movements where request_id='20000000-0000-4000-8000-000000000052'),'Replacement history wrong');
-- Receiving is unchanged and consumes ONLY its exact configured type.
select public.receive_stock('20000000-0000-4000-8000-000000000053','10000000-0000-4000-8000-000000000051',2,0,5,12,'4c55883b-dc3c-53ef-9b95-263f09309b09','2024-03-01');
select pg_temp.check_empty((select quantity=3 from public.empty_crate_stock where crate_type_id='4c55883b-dc3c-53ef-9b95-263f09309b09'),'Receiving did not deduct exact A');
select pg_temp.check_empty((select total_bottles=24 from public.stock where product_id='10000000-0000-4000-8000-000000000051'),'Receiving drinks changed');
select pg_temp.check_empty((select quantity is null from public.known_empty_crates where crate_type_id='58c73e9e-8b2d-5bae-97ef-fe8ae17f4aa8'),'Receiving inferred family compatibility');
-- Retrying a previous count must not rewind a later receiving deduction.
select public.set_empty_crate_count('20000000-0000-4000-8000-000000000052','4c55883b-dc3c-53ef-9b95-263f09309b09',5,'2024-03-01',13);
select pg_temp.check_empty((select quantity=3 from public.empty_crate_stock where crate_type_id='4c55883b-dc3c-53ef-9b95-263f09309b09'),'Retry overwrote receipt deduction');
do $$ declare n numeric; d date; t uuid; begin
  foreach n in array array[-1,0.5,2147483648,'NaN'::numeric,'Infinity'::numeric,null] loop
    begin
      perform public.set_empty_crate_count(gen_random_uuid(),'4c55883b-dc3c-53ef-9b95-263f09309b09',n,'2024-03-02',3);
      raise exception 'Invalid quantity accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  foreach d in array array[null,'infinity'::date,'-infinity'::date,'10000-01-01'::date] loop
    begin
      perform public.set_empty_crate_count(gen_random_uuid(),'4c55883b-dc3c-53ef-9b95-263f09309b09',0,d,3);
      raise exception 'Invalid date accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  foreach t in array array[null::uuid,gen_random_uuid()] loop
    begin
      perform public.set_empty_crate_count(gen_random_uuid(),t,1,'2024-03-02',null);
      raise exception 'Invalid or normalized crate type accepted';
    exception when invalid_parameter_value then null; end;
  end loop;
  begin
    perform public.set_empty_crate_count(gen_random_uuid(),'4c55883b-dc3c-53ef-9b95-263f09309b09',0,'2026-02-30',3);
    raise exception 'Impossible calendar date accepted';
  exception when datetime_field_overflow then null; end;
  begin
    perform public.set_empty_crate_count('20000000-0000-4000-8000-000000000052','4c55883b-dc3c-53ef-9b95-263f09309b09',6,'2024-03-01',3);
    raise exception 'Changed retry quantity accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_empty_crate_count('20000000-0000-4000-8000-000000000052','58c73e9e-8b2d-5bae-97ef-fe8ae17f4aa8',5,'2024-03-01',null);
    raise exception 'Changed retry type accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_empty_crate_count('20000000-0000-4000-8000-000000000052','4c55883b-dc3c-53ef-9b95-263f09309b09',5,'2024-03-02',3);
    raise exception 'Changed retry date accepted';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_empty_crate_count(gen_random_uuid(),'4c55883b-dc3c-53ef-9b95-263f09309b09',0,'2024-03-02',5);
    raise exception 'Stale review overwrote receipt';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.set_empty_crate_count(gen_random_uuid(),'4c55883b-dc3c-53ef-9b95-263f09309b09',0,'2024-03-02',null);
    raise exception 'Initial review overwrote existing count';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.receive_stock(gen_random_uuid(),'10000000-0000-4000-8000-000000000052',1,0,0,24,'58c73e9e-8b2d-5bae-97ef-fe8ae17f4aa8','2024-03-02');
    raise exception 'Receiving substituted family empties';
  exception when invalid_parameter_value then null; end;
  begin
    update public.empty_crate_stock set quantity=1;
    raise exception 'Direct empty stock update allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.empty_crate_stock(crate_type_id,quantity) values (gen_random_uuid(),1);
    raise exception 'Direct empty stock insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.empty_crate_stock;
    raise exception 'Direct empty stock delete allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.empty_crate_movements set resulting_quantity=1;
    raise exception 'Direct history writes allowed';
  exception when insufficient_privilege then null; end;
end $$;
-- Force history insert failure after both initial insertion and existing update.
reset role;
create function pg_temp.fail_empty_history() returns trigger language plpgsql as $$ begin raise exception using errcode='23514',message='forced history failure'; end $$;
create trigger empty_history_failure before insert on public.empty_crate_movements for each row execute function pg_temp.fail_empty_history();
set local role authenticated;
do $$ begin
  begin
    perform public.set_empty_crate_count('20000000-0000-4000-8000-000000000054','4c55883b-dc3c-53ef-9b95-263f09309b09',0,'2024-03-02',3);
    raise exception 'Expected existing count failure';
  exception when check_violation then null; end;
  begin
    perform public.set_empty_crate_count('20000000-0000-4000-8000-000000000055','58c73e9e-8b2d-5bae-97ef-fe8ae17f4aa8',0,'2024-03-02',null);
    raise exception 'Expected initial count failure';
  exception when check_violation then null; end;
end $$;
select pg_temp.check_empty((select quantity=3 from public.empty_crate_stock where crate_type_id='4c55883b-dc3c-53ef-9b95-263f09309b09'),'Update did not roll back');
select pg_temp.check_empty(not exists(select 1 from public.empty_crate_stock where crate_type_id='58c73e9e-8b2d-5bae-97ef-fe8ae17f4aa8'),'Initial insertion did not roll back');
select pg_temp.check_empty((select count(*)=2 from public.empty_crate_movements),'Failed history persisted');
reset role;
drop trigger empty_history_failure on public.empty_crate_movements;
set local role authenticated;
select public.set_empty_crate_count('20000000-0000-4000-8000-000000000054','4c55883b-dc3c-53ef-9b95-263f09309b09',0,'2024-03-02',3);
select public.set_empty_crate_count('20000000-0000-4000-8000-000000000055','58c73e9e-8b2d-5bae-97ef-fe8ae17f4aa8',0,'2024-03-02',null);
select pg_temp.check_empty((select quantity=0 from public.known_empty_crates where crate_type_id='58c73e9e-8b2d-5bae-97ef-fe8ae17f4aa8'),'Confirmed zero still unrecorded');
select pg_temp.check_empty((select quantity_change=-3 and resulting_quantity=0 from public.empty_crate_movements where request_id='20000000-0000-4000-8000-000000000054'),'Zero replacement history wrong');
-- Stock-only types remain valid without a product.
select public.set_empty_crate_count(gen_random_uuid(),'8a992f33-42e3-51b8-912a-c9353a68d1f8',1,'2024-03-02',3);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000052',true);
select pg_temp.check_empty(not exists(select 1 from public.known_empty_crates),'Non-owner view leaked types');
select pg_temp.check_empty(not exists(select 1 from public.empty_crate_movements),'Non-owner read history');
do $$ begin
  begin
    perform public.set_empty_crate_count(gen_random_uuid(),'4c55883b-dc3c-53ef-9b95-263f09309b09',1,'2024-03-02',0);
    raise exception 'Non-owner counted';
  exception when insufficient_privilege then null; end;
  begin
    perform private.set_empty_crate_count(gen_random_uuid(),'4c55883b-dc3c-53ef-9b95-263f09309b09',1,'2024-03-02',0);
    raise exception 'Private function bypassed owner';
  exception when insufficient_privilege then null; end;
end $$;
-- Missing auth identity also fails closed, even with authenticated role.
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin
    perform public.set_empty_crate_count(gen_random_uuid(),'4c55883b-dc3c-53ef-9b95-263f09309b09',1,'2024-03-02',0);
    raise exception 'Missing identity counted';
  exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
  begin
    perform public.set_empty_crate_count(gen_random_uuid(),'4c55883b-dc3c-53ef-9b95-263f09309b09',1,'2024-03-02',0);
    raise exception 'Anonymous counted';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.known_empty_crates;
    raise exception 'Anonymous read known types';
  exception when insufficient_privilege then null; end;
  begin
    perform * from public.empty_crate_movements;
    raise exception 'Anonymous read history';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select pg_temp.check_empty((select relrowsecurity from pg_class where oid='public.empty_crate_movements'::regclass),'Missing history RLS');
select pg_temp.check_empty((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.known_empty_crates'::regclass),'View bypasses RLS');
rollback;
