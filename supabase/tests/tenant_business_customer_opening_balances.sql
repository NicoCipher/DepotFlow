-- Rollback-only first-customer opening balances, including debt, held
-- deposit and exact branded return obligations, for two separate depots.
begin;
insert into auth.users(id) values
 ('89d00000-0000-4000-8000-000000000001'),
 ('89d00000-0000-4000-8000-000000000002'),
 ('89d00000-0000-4000-8000-000000000003'),
 ('89d00000-0000-4000-8000-000000000004');
insert into private.shop_owner(user_id)
 values('89d00000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
insert into public.customers(id,name,phone) values(
 '89d00000-0000-4000-9000-000000000011','Legacy opening client','08000890011');
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
 if n<>31 then raise exception 'Missing 31 tenant FKs, got %',n;end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

insert into private.businesses(id,status) values
 ('89d00000-0000-4000-9000-000000000021','setup'),
 ('89d00000-0000-4000-9000-000000000022','setup');
insert into private.business_memberships(
 business_id,user_id,status,member_kind
) values
 ('89d00000-0000-4000-9000-000000000021',
  '89d00000-0000-4000-8000-000000000002','active','owner'),
 ('89d00000-0000-4000-9000-000000000022',
  '89d00000-0000-4000-8000-000000000003','active','owner');

-- Disposable fixture provisioning; these admin-only trigger disables are
-- never exposed to an authenticated owner through the product.
alter table public.crate_types disable trigger legacy_scope_business_write;
alter table public.products disable trigger legacy_scope_business_write;
alter table public.customers disable trigger legacy_scope_business_write;
insert into public.crate_types(
 id,business_id,name,empty_family,pocket_count
) values
 ('89d00000-0000-4000-9000-000000000031',
  '89d00000-0000-4000-9000-000000000021',
  'A Goldberg/Life/33 shared physical crate','NBL',20),
 ('89d00000-0000-4000-9000-000000000032',
  '89d00000-0000-4000-9000-000000000022',
  'B exact Goldberg crate','NBL',20);
insert into public.products(
 id,business_id,name,bottles_per_crate,full_crate_price,
 bottles_returnable,bottle_type,crate_type_id
) values
 ('89d00000-0000-4000-9000-000000000041',
  '89d00000-0000-4000-9000-000000000021',
  'A Goldberg test',20,10000,true,'Goldberg return bottle',
  '89d00000-0000-4000-9000-000000000031'),
 ('89d00000-0000-4000-9000-000000000042',
  '89d00000-0000-4000-9000-000000000022',
  'B Goldberg test',20,12000,true,'Goldberg return bottle',
  '89d00000-0000-4000-9000-000000000032');
insert into public.customers(id,name,phone,business_id) values
 ('89d00000-0000-4000-9000-000000000051','A Customer','08000890051',
  '89d00000-0000-4000-9000-000000000021'),
 ('89d00000-0000-4000-9000-000000000052','B Customer','08000890052',
  '89d00000-0000-4000-9000-000000000022'),
 ('89d00000-0000-4000-9000-000000000053','A Other Customer','08000890053',
  '89d00000-0000-4000-9000-000000000021');
alter table public.crate_types enable trigger legacy_scope_business_write;
alter table public.products enable trigger legacy_scope_business_write;
alter table public.customers enable trigger legacy_scope_business_write;

-- Inject a disposable write failure at the LAST opening step. A successful
-- atomic implementation must roll back money, deposit and empty obligations
-- that were inserted earlier in that same function invocation.
create function pg_temp.reject_opening_commit()
returns trigger language plpgsql as $failure$
begin
 if new.customer_id='89d00000-0000-4000-9000-000000000053'::uuid then
  raise exception 'Injected final opening journal failure' using errcode='22023';
 end if;
 return new;
end;
$failure$;
create trigger disposable_reject_opening
 after insert on public.customer_opening_balances
 for each row execute function pg_temp.reject_opening_commit();

do $default_off$
begin
 if (select enabled from private.business_customer_opening_gate)
 or has_function_privilege('authenticated',
  'public.record_business_customer_opening(uuid,uuid,uuid,integer,integer,date,text,jsonb,jsonb)',
  'EXECUTE')
 or has_function_privilege('anon',
  'public.record_business_customer_opening(uuid,uuid,uuid,integer,integer,date,text,jsonb,jsonb)',
  'EXECUTE') then
  raise exception 'Opening balances gate/grant unexpectedly enabled';
 end if;
end;
$default_off$;
grant execute on function public.record_business_customer_opening(
 uuid,uuid,uuid,integer,integer,date,text,jsonb,jsonb
) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89d00000-0000-4000-8000-000000000002',true);
do $disabled$
begin
 begin
  perform public.record_business_customer_opening(
    '89d00000-0000-4000-9000-000000000021',
    '89d00000-0000-4000-9000-000000000061',
    '89d00000-0000-4000-9000-000000000051',
    45000,10000,'2026-10-18','Before DepotFlow',
    '[]'::jsonb,'[]'::jsonb);
  raise exception 'Owner posted opening with default-off gate' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$disabled$;
reset role;
update private.business_customer_opening_gate
 set enabled=true where singleton;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89d00000-0000-4000-8000-000000000002',true);
do $owner_a$
declare v jsonb;replayed jsonb;
begin
 v:=public.record_business_customer_opening(
   '89d00000-0000-4000-9000-000000000021',
   '89d00000-0000-4000-9000-000000000061',
   '89d00000-0000-4000-9000-000000000051',
   45000,10000,'2026-10-18','Before DepotFlow',
   '[{"type":"89d00000-0000-4000-9000-000000000031","quantity":2}]'::jsonb,
   '[{"type":"Goldberg return bottle","quantity":7}]'::jsonb
 );
 if v->>'moneyOwed'<>'45000' or v->>'depositHeld'<>'10000'
    or pg_catalog.jsonb_array_length(v->'crates')<>1
    or pg_catalog.jsonb_array_length(v->'bottles')<>1 then
  raise exception 'A opening event incorrect: %',v;
 end if;
 replayed:=public.record_business_customer_opening(
   '89d00000-0000-4000-9000-000000000021',
   '89d00000-0000-4000-9000-000000000061',
   '89d00000-0000-4000-9000-000000000051',
   45000,10000,'2026-10-18','Before DepotFlow',
   '[{"type":"89d00000-0000-4000-9000-000000000031","quantity":2}]'::jsonb,
   '[{"type":"Goldberg return bottle","quantity":7}]'::jsonb
 );
 if replayed is distinct from v then
  raise exception 'Retry did not recover immutable opening: %',replayed;
 end if;
 if (select amount from public.money_owed)<>45000
    or (select amount from public.deposits)<>10000
    or (select quantity from public.crate_obligations)<>2
    or (select quantity from public.bottle_obligations)<>7
    or (select count(*) from public.customer_opening_balances)<>1
    or exists(select 1 from public.sales) then
  raise exception 'A opening was not isolated or balances were double-counted';
 end if;
 begin
  perform public.record_business_customer_opening(
   '89d00000-0000-4000-9000-000000000021',
   '89d00000-0000-4000-9000-000000000061',
   '89d00000-0000-4000-9000-000000000051',
   46000,10000,'2026-10-18','Before DepotFlow',
   '[{"type":"89d00000-0000-4000-9000-000000000031","quantity":2}]'::jsonb,
   '[{"type":"Goldberg return bottle","quantity":7}]'::jsonb);
  raise exception 'Modified retry overwrote owed' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.record_business_customer_opening(
   '89d00000-0000-4000-9000-000000000021',
   '89d00000-0000-4000-9000-000000000062',
   '89d00000-0000-4000-9000-000000000051',
   45000,10000,'2026-10-18','Another request',
   '[]'::jsonb,'[]'::jsonb);
  raise exception 'Second opening added same customer again' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 -- Invalid foreign crate ID must roll back debt/deposit as a unit.
 begin
  perform public.record_business_customer_opening(
   '89d00000-0000-4000-9000-000000000021',
   '89d00000-0000-4000-9000-000000000063',
   '89d00000-0000-4000-9000-000000000053',
   3300,1000,'2026-10-18','Bad crate',
   '[{"type":"89d00000-0000-4000-9000-000000000032","quantity":1}]'::jsonb,
   '[]'::jsonb);
  raise exception 'A used B exact physical crate UUID' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 -- Now use a VALID owned crate/bottle for this customer so the
 -- temporary AFTER INSERT journal trigger rejects ONLY after all financial
 -- and returnable-obligation writes have been attempted.
 begin
  perform public.record_business_customer_opening(
   '89d00000-0000-4000-9000-000000000021',
   '89d00000-0000-4000-9000-000000000064',
   '89d00000-0000-4000-9000-000000000053',
   3300,1000,'2026-10-18','Injected failure at journal',
   '[{"type":"89d00000-0000-4000-9000-000000000031","quantity":1}]'::jsonb,
   '[{"type":"Goldberg return bottle","quantity":2}]'::jsonb);
  raise exception 'Simulated failed journal left a committed opening'
   using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 if exists(select 1 from public.money_owed
            where customer_id='89d00000-0000-4000-9000-000000000053')
  or exists(select 1 from public.deposits
            where customer_id='89d00000-0000-4000-9000-000000000053')
  or exists(select 1 from public.crate_obligations
            where customer_id='89d00000-0000-4000-9000-000000000053')
  or exists(select 1 from public.bottle_obligations
            where customer_id='89d00000-0000-4000-9000-000000000053')
  or exists(select 1 from public.customer_opening_balances
            where customer_id='89d00000-0000-4000-9000-000000000053') then
  raise exception 'Failed final journal left partial financial or empties opening';
 end if;
 -- Direct partial financial edits remain denied to an authenticated owner.
 begin
  insert into public.deposits(customer_id,business_id,amount)
   values('89d00000-0000-4000-9000-000000000053',
     '89d00000-0000-4000-9000-000000000021',1);
  raise exception 'Direct customer deposit write succeeded' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$owner_a$;
reset role;

-- B uses the SAME request UUID and SAME bottle label, but distinct owned
-- customer and entirely separate current balances and opening history.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89d00000-0000-4000-8000-000000000003',true);
do $owner_b$
declare v jsonb;
begin
 v:=public.record_business_customer_opening(
   '89d00000-0000-4000-9000-000000000022',
   '89d00000-0000-4000-9000-000000000061',
   '89d00000-0000-4000-9000-000000000052',
   5000,0,'2026-10-18','Old debt B',
   '[]'::jsonb,'[{"type":"Goldberg return bottle","quantity":3}]'::jsonb
 );
 if v->>'moneyOwed'<>'5000' or v->>'depositHeld'<>'0'
 or (select amount from public.money_owed)<>5000
 or exists(select 1 from public.deposits)
 or (select quantity from public.bottle_obligations)<>3
 or (select count(*) from public.customer_opening_balances)<>1 then
  raise exception 'B received A balances or duplicated opening';
 end if;
 begin
  perform public.record_business_customer_opening(
   '89d00000-0000-4000-9000-000000000022',
   '89d00000-0000-4000-9000-000000000065',
   '89d00000-0000-4000-9000-000000000051',
   1000,0,'2026-10-18','Forged A customer',
   '[]'::jsonb,'[]'::jsonb);
  raise exception 'B wrote A customer balances' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
end;
$owner_b$;
reset role;

-- Original owner's historic RPC still works after request key changed and
-- cannot see the independent A/B balances despite reusing their UUID.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89d00000-0000-4000-8000-000000000001',true);
do $legacy$
declare v uuid;
begin
 v:=public.record_opening_balances(
   '89d00000-0000-4000-9000-000000000061',
   '89d00000-0000-4000-9000-000000000011',
   2500,'2026-10-18','Legacy old debt','[]'::jsonb,'[]'::jsonb);
 if v is null
 or (select count(*) from public.customer_opening_balances)<>1
 or (select amount from public.money_owed)<>2500
 or exists(select 1 from public.deposits) then
  raise exception 'Original shop opening was damaged or saw other shops';
 end if;
end;
$legacy$;
reset role;

-- Once setup is finalized, a lost-response retry must still recover its
-- saved opening; creating a NEW opening is no longer permitted.
update private.businesses set status='active'
 where id='89d00000-0000-4000-9000-000000000022';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89d00000-0000-4000-8000-000000000003',true);
do $activated_replay_only$
declare v jsonb;
begin
 v:=public.record_business_customer_opening(
   '89d00000-0000-4000-9000-000000000022',
   '89d00000-0000-4000-9000-000000000061',
   '89d00000-0000-4000-9000-000000000052',
   5000,0,'2026-10-18','Old debt B',
   '[]'::jsonb,'[{"type":"Goldberg return bottle","quantity":3}]'::jsonb);
 if v->>'moneyOwed'<>'5000' then
  raise exception 'Previously saved B opening lost after activation';
 end if;
 begin
  perform public.record_business_customer_opening(
   '89d00000-0000-4000-9000-000000000022',
   '89d00000-0000-4000-9000-000000000066',
   '89d00000-0000-4000-9000-000000000052',
   7000,0,'2026-10-18','Late added debt','[]'::jsonb,'[]'::jsonb);
  raise exception 'ACTIVE business accepted NEW opening' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$activated_replay_only$;
reset role;

do $three_independent_ledgers$
begin
 if (select count(*) from public.customer_opening_balances)<>3
 or (select count(*) from public.money_owed)<>3
 or (select count(*) from public.deposits)<>1
 or (select count(*) from public.crate_obligations)<>1
 or (select count(*) from public.bottle_obligations)<>2
 or (select count(distinct business_id)
    from public.customer_opening_balances
    where request_id='89d00000-0000-4000-9000-000000000061')<>3
 or exists(select 1 from public.sales)
 or exists(select 1 from public.customer_payments) then
  raise exception 'Legacy/A/B audit, balances or no-sale invariant failed';
 end if;
end;
$three_independent_ledgers$;

update private.business_memberships set status='disabled'
 where business_id='89d00000-0000-4000-9000-000000000022';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89d00000-0000-4000-8000-000000000003',true);
do $revoked_b$
begin
 begin
  perform public.record_business_customer_opening(
   '89d00000-0000-4000-9000-000000000022',
   '89d00000-0000-4000-9000-000000000061',
   '89d00000-0000-4000-9000-000000000052',
   5000,0,'2026-10-18','Old debt B',
   '[]'::jsonb,'[{"type":"Goldberg return bottle","quantity":3}]'::jsonb);
  raise exception 'Revoked owner replayed B opening' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 if exists(select 1 from public.customer_opening_balances)
 or exists(select 1 from public.money_owed)
 or exists(select 1 from public.bottle_obligations) then
  raise exception 'Revoked B owner can still read private customer balances';
 end if;
end;
$revoked_b$;
reset role;
rollback;
