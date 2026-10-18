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
 ('89600000-0000-4000-9000-000000000092','Heineken setup test','NB');
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
 ('89600000-0000-4000-9000-000000000022','setup');
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
-- Guided setup discovery is separately protected; only this disposable
-- test grants its read permission and enables owner business selection.
grant execute on function public.preview_business_assortment_setup(uuid)
 to authenticated;
update private.business_selection_gate set enabled=true where singleton;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000002',true);
do $owner_a$
declare v uuid; v_other uuid; v_goldberg uuid;
begin
 v:=public.create_business_crate_type(
  '89600000-0000-4000-9000-000000000021',
  '89600000-0000-4000-9000-000000000031',
  'NBL shared','NBL',20,null);
 if v='89600000-0000-4000-9000-000000000031'::uuid
   or not exists(select 1 from public.crate_types
     where id=v and business_id='89600000-0000-4000-9000-000000000021') then
   raise exception 'A crate PK was caller-controlled or not saved';
 end if;
 perform set_config('fixture.a_crate_shared',v::text,true);
 -- Repeating the same exact crate setup is idempotent.
 if public.create_business_crate_type(
   '89600000-0000-4000-9000-000000000021',
   '89600000-0000-4000-9000-000000000031',
   'NBL shared','NBL',20,null)<>v then
   raise exception 'Crate setup replay failed';
 end if;
 -- Same-size Heineken is a DIFFERENT crate, not an implicit swap.
 v_other:=public.create_business_crate_type(
  '89600000-0000-4000-9000-000000000021',
  '89600000-0000-4000-9000-000000000032',
  'Heineken exact crate','NBL',20,null);
 if v_other=v then raise exception 'Separate crate tokens shared a PK'; end if;
 perform set_config('fixture.a_crate_other',v_other::text,true);

 v_goldberg:=public.add_business_catalogue_drink(
  '89600000-0000-4000-9000-000000000021',
  '89600000-0000-4000-9000-000000000041',
  '89600000-0000-4000-9000-000000000090',
  v,20,10000,
  null,null,500,true,'Goldberg bottle',null);
 if v_goldberg='89600000-0000-4000-9000-000000000041'::uuid then
   raise exception 'Product PK remained caller-controlled';
 end if;
 perform set_config('fixture.a_product_goldberg',v_goldberg::text,true);
 -- Another master drink may EXPLICITLY reuse the exact A shared crate UUID.
 perform public.add_business_catalogue_drink(
  '89600000-0000-4000-9000-000000000021',
  '89600000-0000-4000-9000-000000000043',
  '89600000-0000-4000-9000-000000000091',
  v,20,10500,
  null,null,550,true,'33 bottle',null);
 perform public.add_business_catalogue_drink(
  '89600000-0000-4000-9000-000000000021',
  '89600000-0000-4000-9000-000000000044',
  '89600000-0000-4000-9000-000000000092',
  v_other,20,14000,
  null,null,700,true,'Heineken bottle',null);
 -- Replay cannot create duplicate rows or rewrite price.
 if public.add_business_catalogue_drink(
  '89600000-0000-4000-9000-000000000021',
  '89600000-0000-4000-9000-000000000041',
  '89600000-0000-4000-9000-000000000090',
  v,20,10000,
  null,null,500,true,'Goldberg bottle',null)
  <>v_goldberg then
    raise exception 'Product setup replay failed';
 end if;
 begin
   perform public.add_business_catalogue_drink(
    '89600000-0000-4000-9000-000000000021',
    '89600000-0000-4000-9000-000000000045',
    '89600000-0000-4000-9000-000000000090',
    v,20,9000,
    null,null,450,true,'Goldberg bottle',null);
   raise exception 'Duplicate master drink added to A' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
   perform public.add_business_catalogue_drink(
    '89600000-0000-4000-9000-000000000021',
    '89600000-0000-4000-9000-000000000046',
    '89600000-0000-4000-9000-000000000090',
    v_other,12,10000,
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
declare v uuid;
begin
 v:=public.create_business_crate_type(
  '89600000-0000-4000-9000-000000000022',
  '89600000-0000-4000-9000-000000000033',
  'B Goldberg own crate','NBL',20,null);
 if v='89600000-0000-4000-9000-000000000033'::uuid then
   raise exception 'B crate PK remained caller-controlled';
 end if;
 perform set_config('fixture.b_crate',v::text,true);
 perform public.add_business_catalogue_drink(
  '89600000-0000-4000-9000-000000000022',
  '89600000-0000-4000-9000-000000000042',
  '89600000-0000-4000-9000-000000000090',
  v,20,13000,
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
    current_setting('fixture.a_crate_shared')::uuid,20,12000,
    null,null,600,true,'33 bottle',null);
   raise exception 'B enrolled drink with A crate' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
end;
$owner_b$;
reset role;

-- An authenticated caller must never select global PKs. A known UUID
-- belonging to another business is safe as a new tenant-local request token.
-- Savepoint makes this an adversarial rollback-only contract test.
savepoint foreign_assortment_request_token;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000002',true);
do $foreign_tokens_and_bounds$
declare v uuid;
begin
 v:=public.create_business_crate_type(
  '89600000-0000-4000-9000-000000000021',
  current_setting('fixture.b_crate')::uuid,
  'A crate using foreign token','NBL',20,null);
 if v=current_setting('fixture.b_crate')::uuid
    or v=current_setting('fixture.a_crate_shared')::uuid then
   raise exception 'Foreign UUID token selected a global crate PK';
 end if;
 begin
  perform public.create_business_crate_type(
    '89600000-0000-4000-9000-000000000021',
    '89600000-0000-4000-9000-000000000070',
    'Huge crate','NBL',2147483647,null);
  raise exception 'Direct RPC accepted oversized crate' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.add_business_catalogue_drink(
    '89600000-0000-4000-9000-000000000021',
    '89600000-0000-4000-9000-000000000071',
    '89600000-0000-4000-9000-000000000091',
    current_setting('fixture.a_crate_shared')::uuid,2147483647,
    10500,null,null,null,true,'33 bottle',null);
  raise exception 'Direct RPC accepted oversized pack' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.add_business_catalogue_drink(
    '89600000-0000-4000-9000-000000000021',
    '89600000-0000-4000-9000-000000000072',
    '89600000-0000-4000-9000-000000000091',
    current_setting('fixture.a_crate_shared')::uuid,20,
    0,null,null,null,true,'33 bottle',null);
  raise exception 'Direct RPC accepted zero full-crate price' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.add_business_catalogue_drink(
    '89600000-0000-4000-9000-000000000021',
    current_setting('fixture.a_product_goldberg')::uuid,
    '89600000-0000-4000-9000-000000000091',
    current_setting('fixture.a_crate_shared')::uuid,20,
    10500,null,null,null,true,'33 bottle',null);
  if (select count(*) from public.products
      where business_id='89600000-0000-4000-9000-000000000021'
        and id=current_setting('fixture.a_product_goldberg')::uuid)<>1 then
    raise exception 'Product token rewrote an existing product';
  end if;
  raise exception 'Reused product PK request token permitted altered details'
    using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
end;
$foreign_tokens_and_bounds$;
reset role;
rollback to savepoint foreign_assortment_request_token;
release savepoint foreign_assortment_request_token;

-- B uses A's *actual generated product PK* as a token for a distinct
-- catalogue selection. There must be no foreign PK collision oracle.
savepoint foreign_product_request_token;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000003',true);
do $foreign_product_token$
declare v uuid;
begin
 v:=public.add_business_catalogue_drink(
  '89600000-0000-4000-9000-000000000022',
  current_setting('fixture.a_product_goldberg')::uuid,
  '89600000-0000-4000-9000-000000000091',
  current_setting('fixture.b_crate')::uuid,
  20,10500,null,null,550,true,'33 bottle',null);
 if v=current_setting('fixture.a_product_goldberg')::uuid then
   raise exception 'Foreign token selected A product primary key';
 end if;
 if not exists(select 1 from public.products
   where id=v and business_id='89600000-0000-4000-9000-000000000022') then
   raise exception 'B generated product did not remain tenant-scoped';
 end if;
end;
$foreign_product_token$;
reset role;
rollback to savepoint foreign_product_request_token;
release savepoint foreign_product_request_token;

-- Shared catalogue identities are allowed; no other business's
-- assortment price, selected drink, or physical crate can be leaked.
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000002',true);
do $a_setup_preview$
declare v jsonb;
begin
 v:=public.preview_business_assortment_setup(
  '89600000-0000-4000-9000-000000000021');
 if v->>'businessId'<>'89600000-0000-4000-9000-000000000021'
  or pg_catalog.jsonb_array_length(v->'catalogue')<3
  or pg_catalog.jsonb_array_length(v->'crateTypes')<>2
  or pg_catalog.jsonb_array_length(v->'configuredDrinks')<>3
  or v->>'canActivate'<>'false'
  or v->>'readOnly'<>'true'
  or v->>'truncated'<>'false'
  or (v->>'catalogueTotal')::int<>pg_catalog.jsonb_array_length(v->'catalogue')
  or v->>'crateTypesTotal'<>'2'
  or v->>'configuredDrinksTotal'<>'3'
  or (v->'configuredDrinks')::text like '%13000%'
  or (v->'crateTypes')::text like '%B Goldberg own crate%' then
   raise exception 'A setup preview failed owner isolation: %',v;
 end if;
 begin
  perform public.preview_business_assortment_setup(
   '89600000-0000-4000-9000-000000000022');
  raise exception 'Owner A obtained B setup' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$a_setup_preview$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000003',true);
do $b_setup_preview$
declare v jsonb;
begin
 v:=public.preview_business_assortment_setup(
  '89600000-0000-4000-9000-000000000022');
 if pg_catalog.jsonb_array_length(v->'configuredDrinks')<>1
  or pg_catalog.jsonb_array_length(v->'crateTypes')<>1
  or (v->'configuredDrinks')::text like '%10500%'
  or (v->'crateTypes')::text like '%NBL shared%' then
  raise exception 'B preview mixed A assortment/pricing: %',v;
 end if;
end;
$b_setup_preview$;
reset role;

-- A catalogue above the 250-row page limit must be explicitly
-- flagged, never silently presented to the owner as fully selectable.
savepoint overflow_master_catalogue;
insert into public.product_catalogue(id,name,manufacturer)
select pg_catalog.gen_random_uuid(),
  'Fixture overflow drink '||n::text,'NB'
from pg_catalog.generate_series(1,251) n;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000002',true);
do $catalogue_truncation$
declare v jsonb;
begin
 v:=public.preview_business_assortment_setup(
  '89600000-0000-4000-9000-000000000021');
 if v->>'truncated'<>'true'
  or (v->>'catalogueTotal')::int<=250
  or pg_catalog.jsonb_array_length(v->'catalogue')<>250
  or v->>'configuredDrinksTotal'<>'3' then
  raise exception 'Shared catalogue overflow was silently hidden: %',v;
 end if;
end;
$catalogue_truncation$;
reset role;
rollback to savepoint overflow_master_catalogue;
release savepoint overflow_master_catalogue;

-- Same completeness contract for the owner's exact physical crate types.
savepoint overflow_owned_crates;
alter table public.crate_types disable trigger legacy_scope_business_write;
insert into public.crate_types(
 id,business_id,name,empty_family,pocket_count
)
select pg_catalog.gen_random_uuid(),
 '89600000-0000-4000-9000-000000000021'::uuid,
 'Fixture physical crate '||n::text,'NBL',20
from pg_catalog.generate_series(1,251) n;
alter table public.crate_types enable trigger legacy_scope_business_write;
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89600000-0000-4000-8000-000000000002',true);
do $crate_truncation$
declare v jsonb;
begin
 v:=public.preview_business_assortment_setup(
  '89600000-0000-4000-9000-000000000021');
 if v->>'truncated'<>'true'
  or (v->>'crateTypesTotal')::int<=250
  or pg_catalog.jsonb_array_length(v->'crateTypes')<>250 then
  raise exception 'Owned physical crate overflow silently hidden: %',v;
 end if;
end;
$crate_truncation$;
reset role;
rollback to savepoint overflow_owned_crates;
release savepoint overflow_owned_crates;

do $verify$
begin
 if (select count(*) from public.products)<>4
    or (select count(*) from public.crate_types)<>3
    or (select count(*) from public.products
        where catalogue_product_id='89600000-0000-4000-9000-000000000090')<>2
    or (select count(*) from public.products where
        business_id='89600000-0000-4000-9000-000000000021'
        and crate_type_id=current_setting('fixture.a_crate_shared')::uuid)<>2
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
