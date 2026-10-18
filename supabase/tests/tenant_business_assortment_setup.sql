-- Rollback-only new-business physical crate and catalogue configuration contract.
-- All rollout gates and authenticated EXECUTE grants revert with this transaction.
begin;
insert into auth.users(id) values
 ('89600000-0000-4000-8000-000000000001'),
 ('89600000-0000-4000-8000-000000000002'),
 ('89600000-0000-4000-8000-000000000003');
insert into private.shop_owner(user_id)
values ('89600000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
insert into public.product_catalogue(id,name,manufacturer) values
 ('89600000-0000-4000-9000-000000000090','Goldberg setup test','NB'),
 ('89600000-0000-4000-9000-000000000091','33 setup test','NB'),
 ('89600000-0000-4000-9000-000000000092','Heineken setup test','NBL');
select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate$
declare r record; n int:=0;
begin
 for r in
  select ns.nspname s,c.relname t,k.conname
  from pg_constraint k
  join pg_class c on c.oid=k.conrelid
  join pg_namespace ns on ns.oid=c.relnamespace
  join private.legacy_scope_tables() tab
    on tab.schema_name=ns.nspname and tab.table_name=c.relname
  where k.contype='f' and left(k.conname,7)='tenant_'
 loop
  execute format('alter table %I.%I validate constraint %I',
    r.s,r.t,r.conname);
  n:=n+1;
 end loop;
 if n<>31 then raise exception 'Expected 31 tenant FKs, got %',n;end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

insert into private.businesses(id,status) values
 ('89600000-0000-4000-9000-000000000021','setup'),
 ('89600000-0000-4000-9000-000000000022','active');
insert into private.business_memberships(
 business_id,user_id,status,member_kind
) values
 ('89600000-0000-4000-9000-000000000021',
  '89600000-0000-4000-8000-000000000002','active','owner'),
 ('89600000-0000-4000-9000-000000000022',
  '89600000-0000-4000-8000-000000000003','active','owner');

do $inactive$
begin
 if (select enabled from private.business_assortment_setup_gate)
    or has_function_privilege('authenticated',
       'public.create_business_crate_type(uuid,uuid,text,text,integer,text)','EXECUTE')
    or has_function_privilege('authenticated',
       'public.add_business_catalogue_drink(uuid,uuid,uuid,uuid,integer,integer,integer,integer,integer,boolean,text,text)','EXECUTE')
    or has_function_privilege('anon',
       'public.create_business_crate_type(uuid,uuid,text,text,integer,text)','EXECUTE')
    or has_function_privilege('anon',
       'public.add_business_catalogue_drink(uuid,uuid,uuid,uuid,integer,integer,integer,integer,integer,boolean,text,text)','EXECUTE') then
    raise exception 'Draft setup unexpectedly enabled';
 end if;
end;
$inactive$;
grant execute on function public.create_business_crate_type(
 uuid,uuid,text,text,integer,text
) to authenticated;
grant execute on function public.add_business_catalogue_drink(
 uuid,uuid,uuid,uuid,integer,integer,integer,integer,integer,boolean,text,text
) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000002',true);
do $disabled$
begin
 begin
   perform public.create_business_crate_type(
    '89600000-0000-4000-9000-000000000021',
    '89600000-0000-4000-9000-000000000031',
    'NBL shared','NBL',20,null);
   raise exception 'Disabled assortment gate permitted crate' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$disabled$;
reset role;
update private.business_assortment_setup_gate set enabled=true where singleton;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000002',true);
do $owner_a$
declare v uuid;
begin
 v:=public.create_business_crate_type(
  '89600000-0000-4000-9000-000000000021',
  '89600000-0000-4000-9000-000000000031',
  'NBL shared','NBL',20,null);
 if v<>'89600000-0000-4000-9000-000000000031'::uuid then
   raise exception 'A crate identity changed';
 end if;
 -- Repeating the same exact crate setup is idempotent.
 if public.create_business_crate_type(
   '89600000-0000-4000-9000-000000000021',v,
   'NBL shared','NBL',20,null)<>v then
   raise exception 'Crate setup replay failed';
 end if;
 -- Same-size Heineken is a DIFFERENT crate, not an implicit swap.
 perform public.create_business_crate_type(
  '89600000-0000-4000-9000-000000000021',
  '89600000-0000-4000-9000-000000000032',
  'Heineken exact crate','NBL',20,null);

 perform public.add_business_catalogue_drink(
  '89600000-0000-4000-9000-000000000021',
  '89600000-0000-4000-9000-000000000041',
  '89600000-0000-4000-9000-000000000090',
  '89600000-0000-4000-9000-000000000031',20,10000,
  null,null,500,true,'Goldberg bottle',null);
 -- Another master drink may EXPLICITLY reuse the exact A shared crate UUID.
 perform public.add_business_catalogue_drink(
  '89600000-0000-4000-9000-000000000021',
  '89600000-0000-4000-9000-000000000043',
  '89600000-0000-4000-9000-000000000091',
  '89600000-0000-4000-9000-000000000031',20,10500,
  null,null,550,true,'33 bottle',null);
 perform public.add_business_catalogue_drink(
  '89600000-0000-4000-9000-000000000021',
  '89600000-0000-4000-9000-000000000044',
  '89600000-0000-4000-9000-000000000092',
  '89600000-0000-4000-9000-000000000032',20,14000,
  null,null,700,true,'Heineken bottle',null);
 -- Replay cannot create duplicate rows or rewrite price.
 if public.add_business_catalogue_drink(
  '89600000-0000-4000-9000-000000000021',
  '89600000-0000-4000-9000-000000000041',
  '89600000-0000-4000-9000-000000000090',
  '89600000-0000-4000-9000-000000000031',20,10000,
  null,null,500,true,'Goldberg bottle',null)
  <>'89600000-0000-4000-9000-000000000041'::uuid then
    raise exception 'Product setup replay failed';
 end if;
 begin
   perform public.add_business_catalogue_drink(
    '89600000-0000-4000-9000-000000000021',
    '89600000-0000-4000-9000-000000000045',
    '89600000-0000-4000-9000-000000000090',
    '89600000-0000-4000-9000-000000000031',20,9000,
    null,null,450,true,'Goldberg bottle',null);
   raise exception 'Duplicate master drink added to A' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
   perform public.add_business_catalogue_drink(
    '89600000-0000-4000-9000-000000000021',
    '89600000-0000-4000-9000-000000000046',
    '89600000-0000-4000-9000-000000000090',
    '89600000-0000-4000-9000-000000000032',12,10000,
    null,null,500,true,'Goldberg bottle',null);
   raise exception 'Pocket mismatch accepted' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
   perform public.create_business_crate_type(
    '89600000-0000-4000-9000-000000000022',
    '89600000-0000-4000-9000-000000000039',
    'Forged','NBL',20,null);
   raise exception 'A created B crate' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.create_business_crate_type(
    '89600000-0000-4000-9000-000000000021',
    '89600000-0000-4000-9000-000000000031',
    'Changed name','NBL',20,null);
   raise exception 'Existing crate name silently edited' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
   insert into public.crate_types(name,empty_family,pocket_count,business_id)
    values('Direct bypass','NBL',20,
     '89600000-0000-4000-9000-000000000021');
   raise exception 'Direct crate write bypassed RPC' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$owner_a$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000003',true);
do $owner_b$
begin
 perform public.create_business_crate_type(
  '89600000-0000-4000-9000-000000000022',
  '89600000-0000-4000-9000-000000000033',
  'B Goldberg own crate','NBL',20,null);
 perform public.add_business_catalogue_drink(
  '89600000-0000-4000-9000-000000000022',
  '89600000-0000-4000-9000-000000000042',
  '89600000-0000-4000-9000-000000000090',
  '89600000-0000-4000-9000-000000000033',20,13000,
  null,null,650,true,'Goldberg bottle',null);
 if (select count(*) from public.products)<>1
    or (select full_crate_price from public.products limit 1)<>13000
    or (select count(*) from public.crate_types)<>1 then
   raise exception 'B sees A crate or A price';
 end if;
 begin
   perform public.add_business_catalogue_drink(
    '89600000-0000-4000-9000-000000000022',
    '89600000-0000-4000-9000-000000000047',
    '89600000-0000-4000-9000-000000000091',
    '89600000-0000-4000-9000-000000000031',20,12000,
    null,null,600,true,'33 bottle',null);
   raise exception 'B enrolled drink with A crate' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
end;
$owner_b$;
reset role;

do $verify$
begin
 if (select count(*) from public.products)<>4
    or (select count(*) from public.crate_types)<>3
    or (select count(*) from public.products
        where catalogue_product_id='89600000-0000-4000-9000-000000000090')<>2
    or (select count(*) from public.products where
        business_id='89600000-0000-4000-9000-000000000021'
        and crate_type_id='89600000-0000-4000-9000-000000000031')<>2
    or (select count(*) from public.stock)<>0
    or (select count(*) from public.sales)<>0 then
   raise exception 'Multi-business assortment isolation or no-stock invariant failed';
 end if;
end;
$verify$;

update private.business_memberships set status='disabled'
 where business_id='89600000-0000-4000-9000-000000000022';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000003',true);
do $revoked$
begin
 begin
  perform public.add_business_catalogue_drink(
   '89600000-0000-4000-9000-000000000022',
   '89600000-0000-4000-9000-000000000042',
   '89600000-0000-4000-9000-000000000090',
   '89600000-0000-4000-9000-000000000033',20,13000,
   null,null,650,true,'Goldberg bottle',null);
  raise exception 'Revoked owner can replay setup' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 if exists(select 1 from public.products) then
   raise exception 'Revoked owner can read product setup';
 end if;
end;
$revoked$;
reset role;
rollback;
