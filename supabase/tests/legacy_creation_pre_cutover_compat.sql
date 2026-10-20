-- Rollback-only regression for DB-FIRST deployment while old Walnik
-- application is still live. New ID-generating RPCs must coexist with the
-- historical create endpoints. Runs ONLY before the gated final cutover.
begin;
do $staging_access$
begin
 if not has_column_privilege('authenticated','public.customers','id','INSERT')
    or not has_column_privilege('authenticated','public.customers','name','INSERT')
    or has_column_privilege('authenticated','public.customers','business_id','INSERT')
    or not has_column_privilege('authenticated','public.products','id','INSERT')
    or not has_function_privilege('authenticated',
       'public.create_crate_type(uuid,text,text,numeric,text)','EXECUTE')
    or not has_function_privilege('authenticated',
       'private.create_crate_type(uuid,text,text,numeric,text)','EXECUTE')
    or not has_function_privilege('authenticated',
       'public.create_legacy_customer(uuid,text,text,text,text)','EXECUTE')
    or not has_function_privilege('authenticated',
       'public.create_legacy_crate_type(uuid,text,text,integer,text)','EXECUTE')
    or not has_function_privilege('authenticated',
       'public.create_legacy_product(uuid,text,text,text,uuid,integer,integer,integer,integer,integer,boolean,text,uuid)','EXECUTE')
    or exists(select 1 from private.legacy_creation_cutover_gate
       where authorized is true) then
    raise exception 'Database-first staging broke original creation or opened cutover';
 end if;
end;
$staging_access$;
insert into auth.users(id) values ('89e00000-0000-4000-8000-000000000001');
insert into private.shop_owner(user_id)
values ('89e00000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89e00000-0000-4000-8000-000000000001',true);
-- Actual old client customer creation, including an old caller-chosen ID.
insert into public.customers(id,name,phone) values
 ('89e00000-0000-4000-9000-000000000011',
 'Existing client remains supported','08000000011');
-- The old crate RPC must still create a physical crate by submitted ID.
select public.create_crate_type(
 '89e00000-0000-4000-9000-000000000012',
 'Existing client crate','NB',12,null);
-- Existing app also POSTs a direct product row using its own request ID.
insert into public.products(
 id,name,bottles_per_crate,full_crate_price,bottles_returnable,
 crate_type_id
) values (
 '89e00000-0000-4000-9000-000000000013',
 'Existing client drink',12,6000,false,
 '89e00000-0000-4000-9000-000000000012'
);
do $old_client_works$
begin
 if not exists(select 1 from public.customers
    where id='89e00000-0000-4000-9000-000000000011')
 or not exists(select 1 from public.crate_types
    where id='89e00000-0000-4000-9000-000000000012')
 or not exists(select 1 from public.products
    where id='89e00000-0000-4000-9000-000000000013') then
   raise exception 'Original-client creates failed during staged rollout';
 end if;
end;
$old_client_works$;
reset role;
rollback;
