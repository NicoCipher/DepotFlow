-- M2d-2: revoke READ access on an active legacy business suspension.
-- Disposable Postgres 16 fixture; all records and gate changes roll back.
begin;
-- Rollback-only legacy ID fixture: customers are now created through a
-- generated-ID legacy RPC, NOT direct authenticated INSERT(id). Preserve
-- historical trigger/RLS constraints under a temporary test-only grant.
grant insert(id) on public.customers to authenticated;
insert into auth.users(id) values
 ('89000000-0000-4000-8000-000000000101'),
 ('89000000-0000-4000-8000-000000000102');
insert into private.shop_owner(user_id)
values ('89000000-0000-4000-8000-000000000101');
select private.link_legacy_shop_business();

insert into public.customers(id,name,phone)
values ('89000000-0000-4000-9000-000000000111',
  'M2d2 legacy customer','08000000111');
insert into public.sales(id,customer_id,total_amount,paid_amount)
values ('89000000-0000-4000-9000-000000000112',
 '89000000-0000-4000-9000-000000000111',1250,500);
insert into public.product_catalogue(id,name)
values ('89000000-0000-4000-9000-000000000113','M2d2 master product');
insert into public.shop_profile(id,name,address,phone)
values (true,'Legacy Drinks','Lagos','08000000123');

create function pg_temp.ok(v boolean,msg text)
returns void language plpgsql as $$
begin
 if v is distinct from true then raise exception '%',msg; end if;
end;$$;

do $metadata$
declare v_count int;
begin
 if has_function_privilege('anon',
     'private.verified_legacy_owner_read()','EXECUTE')
    or has_function_privilege('service_role',
     'private.verified_legacy_owner_read()','EXECUTE')
    or not has_function_privilege('authenticated',
     'private.verified_legacy_owner_read()','EXECUTE') then
    raise exception 'Incorrect private active-owner helper grants';
 end if;
 select count(*) into v_count
 from pg_policy pol
 join pg_class cls on cls.oid=pol.polrelid
 join pg_namespace ns on ns.oid=cls.relnamespace
 where ns.nspname='public' and pol.polcmd='r'
 and pol.polname in ('owner_read','owner_profile','owner_empty_choices')
 and pg_get_expr(pol.polqual,pol.polrelid)
   like '%is_shop_owner%';
 -- M2e-2 strengthens the customer SELECT policy to check exact
 -- business_id membership rather than a global is_shop_owner() predicate.
 -- All 26 original public owner SELECT policies are now scoped:
 -- 17 financial/obligation/profile by exact legacy business_id,
 -- 7 inventory by verified active tenant, 1 customer and 1 shared master.
 -- A direct singleton-only read policy would leak future business data.
 if v_count<>0
    or (select count(*) from pg_policy pol
     join pg_class cls on cls.oid=pol.polrelid
     join pg_namespace ns on ns.oid=cls.relnamespace
     where ns.nspname='public'
       and cls.relname in (
         'bottle_deposit_price','bottle_obligations','crate_deposit_prices',
         'crate_obligations','crate_swap_rules','customer_opening_balances',
         'customer_payments','deposits','money_owed',
         'product_cost_history','product_selling_price_history',
         'sale_empty_bottle_returns','sale_empty_crate_returns',
         'sale_empty_decisions','sale_items','sales','shop_profile'
       )
       and pol.polcmd='r'
       and pg_get_expr(pol.polqual,pol.polrelid)
           like '%can_read_legacy_customer%')<>17
    or (select count(*) from pg_policy pol
     join pg_class cls on cls.oid=pol.polrelid
     where cls.relname in ('product_cost_history','product_selling_price_history')
       and pol.polcmd='r'
       and pg_get_expr(pol.polqual,pol.polrelid)
           like '%owner_user_id%')<>2
    or
    (select count(*) from pg_policy pol
     join pg_class cls on cls.oid=pol.polrelid
     join pg_namespace ns on ns.oid=cls.relnamespace
     where ns.nspname='public'
       and cls.relname in (
         'products','stock','stock_movements','crate_types',
         'empty_crate_stock','empty_crate_movements','empty_bottle_stock'
       )
       and pol.polname='owner_read' and pol.polcmd='r'
       and pg_get_expr(pol.polqual,pol.polrelid)
           like '%can_read_tenant_inventory%')<>7
    or not exists (
   select 1 from pg_policy pol
   join pg_class cls on cls.oid=pol.polrelid
   join pg_namespace ns on ns.oid=cls.relnamespace
   where ns.nspname='public' and cls.relname='product_catalogue'
     and pol.polname='owner_read' and pol.polcmd='r'
     and pg_get_expr(pol.polqual,pol.polrelid)
          like '%can_read_shared_product_catalogue%'
 )
 or not exists (
   select 1 from pg_policy pol
   join pg_class cls on cls.oid=pol.polrelid
   join pg_namespace ns on ns.oid=cls.relnamespace
   where ns.nspname='public' and cls.relname='customers'
     and pol.polname='owner_read' and pol.polcmd='r'
     and pg_get_expr(pol.polqual,pol.polrelid)
         like '%can_read_legacy_customer%'
     and pg_get_expr(pol.polqual,pol.polrelid)
         like '%can_manage_new_customer%'
 ) then
   raise exception 'All original read policies must remain tenant protected (legacy %)',v_count;
 end if;
end;
$metadata$;

-- BEFORE activation: pilot reads behave exactly as before.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89000000-0000-4000-8000-000000000101',true);
select pg_temp.ok(public.is_shop_owner(),
  'Before activation the original owner lost access');
select pg_temp.ok((select count(*)=1 from public.customers where
 id='89000000-0000-4000-9000-000000000111'),
 'Before activation owner cannot see customers');
select pg_temp.ok((select count(*)=1 from public.sales where
 id='89000000-0000-4000-9000-000000000112'),
 'Before activation owner cannot see sales');
select pg_temp.ok((select count(*)=1 from private.shop_owner),
 'Before activation owner cannot see identity row');
reset role;

-- Preserve exact original business scope with no new signup.
select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());

-- The newer mixed-tender ledger adds a deferred SALE INSERT trigger.
-- Flush its pending event before the in-transaction ALTER TABLE VALIDATE;
-- then restore deferral for any subsequent atomic mixed-tender writes.
set constraints all immediate;
do $validate$
declare r record; v_count integer:=0;
begin
 for r in
  select ns.nspname s, cls.relname t, c.conname k
  from pg_constraint c
  join pg_class cls on cls.oid=c.conrelid
  join pg_namespace ns on ns.oid=cls.relnamespace
  join private.legacy_scope_tables() sc
    on sc.schema_name=ns.nspname and sc.table_name=cls.relname
  where c.contype='f' and left(c.conname,7)='tenant_'
 loop
   execute pg_catalog.format('alter table %I.%I validate constraint %I',
     r.s,r.t,r.k);
   v_count:=v_count+1;
 end loop;
 if v_count<>31 then
   raise exception 'Expected 31 existing M2c shadow FKs, got %',v_count;
 end if;
end;
$validate$;
set constraints all deferred;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

-- Owner still sees their own shop after successful activation.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89000000-0000-4000-8000-000000000101',true);
select pg_temp.ok(public.is_shop_owner(), 'Activated owner check failed');
select pg_temp.ok((select count(*)=1 from public.customers where
 id='89000000-0000-4000-9000-000000000111'),
 'Activated owner cannot see own customers');
select pg_temp.ok((select count(*)=1 from public.sales where
 id='89000000-0000-4000-9000-000000000112'),
 'Activated owner cannot see own sales');
select pg_temp.ok((select count(*)=1 from public.product_catalogue where
 id='89000000-0000-4000-9000-000000000113'),
 'Activated owner cannot read shared catalogue');
reset role;

-- Revoke membership without deleting a customer, payment, sale or product.
update private.business_memberships set status='disabled'
where user_id='89000000-0000-4000-8000-000000000101';

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89000000-0000-4000-8000-000000000101',true);
select pg_temp.ok(not public.is_shop_owner(),
 'Suspended legacy owner still authorized');
select pg_temp.ok(not exists(select 1 from public.customers
  where id='89000000-0000-4000-9000-000000000111'),
 'Suspended owner still reads customers');
select pg_temp.ok(not exists(select 1 from public.sales
  where id='89000000-0000-4000-9000-000000000112'),
 'Suspended owner still reads sales');
select pg_temp.ok(not exists(select 1 from public.product_catalogue
  where id='89000000-0000-4000-9000-000000000113'),
 'Suspended owner still reads shared catalogue');
select pg_temp.ok(not exists(select 1 from public.shop_profile),
 'Suspended owner still reads business profile');
select pg_temp.ok(not exists(select 1 from private.shop_owner),
 'Suspended owner can still see private owner identity');

-- Another authenticated user cannot inherit pilot data.
select set_config('request.jwt.claim.sub',
 '89000000-0000-4000-8000-000000000102',true);
select pg_temp.ok(not public.is_shop_owner(),
 'Other Auth user was authorized');
select pg_temp.ok(not exists(select 1 from public.customers),
 'Other Auth user saw legacy customers');
reset role;

-- Restore original membership: access resumes with same unchanged records.
update private.business_memberships set status='active'
where user_id='89000000-0000-4000-8000-000000000101';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89000000-0000-4000-8000-000000000101',true);
select pg_temp.ok(public.is_shop_owner(),
 'Reactivated owner could not reauthenticate');
select pg_temp.ok((select total_amount=1250 and paid_amount=500
 from public.sales where id='89000000-0000-4000-9000-000000000112'),
 'Revocation rewrote historical receipts or balances');
rollback;
