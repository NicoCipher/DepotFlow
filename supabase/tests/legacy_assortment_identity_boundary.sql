-- Rollback-only production-equivalent client privilege boundary.
-- The disposable historical fixture temporarily grants unsafe legacy create
-- privileges, so revoke them inside this transaction before adversarial tests.
begin;
revoke insert on public.products from authenticated;
revoke execute on function public.create_crate_type(uuid,text,text,numeric,text)
 from authenticated;
revoke execute on function private.create_crate_type(uuid,text,text,numeric,text)
 from authenticated;
do $no_oracle$
begin
 if has_any_column_privilege('authenticated','public.products','INSERT')
    or has_function_privilege('authenticated',
      'public.create_crate_type(uuid,text,text,numeric,text)','EXECUTE')
    or has_function_privilege('authenticated',
      'private.create_crate_type(uuid,text,text,numeric,text)','EXECUTE')
    or not has_function_privilege('authenticated',
      'public.create_legacy_crate_type(uuid,text,text,integer,text)','EXECUTE')
    or not has_function_privilege('authenticated',
      'public.create_legacy_product(uuid,text,text,text,uuid,integer,integer,integer,integer,integer,boolean,text,uuid)','EXECUTE')
    or has_function_privilege('anon',
      'public.create_legacy_product(uuid,text,text,text,uuid,integer,integer,integer,integer,integer,boolean,text,uuid)','EXECUTE')
 then raise exception 'Legacy assortment Data API identity boundary not closed';end if;
end;
$no_oracle$;

insert into auth.users(id) values
 ('89d00000-0000-4000-8000-000000000001'),
 ('89d00000-0000-4000-8000-000000000002');
insert into private.shop_owner(user_id)
 values('89d00000-0000-4000-8000-000000000001');
-- A simulated foreign depot has actual global IDs potentially known to Walnik.
insert into private.businesses(id,status) values
 ('89d00000-0000-4000-9000-000000000011','setup');
insert into public.crate_types(
 id,name,empty_family,pocket_count,is_legacy,business_id
) values(
 '89d00000-0000-4000-9000-000000000012','Foreign crate','Other',20,false,
 '89d00000-0000-4000-9000-000000000011'
);
insert into public.products(
 id,name,bottles_per_crate,full_crate_price,bottles_returnable,
 crate_type_id,business_id,empty_family
) values(
 '89d00000-0000-4000-9000-000000000013','Foreign drink',20,12000,false,
 '89d00000-0000-4000-9000-000000000012',
 '89d00000-0000-4000-9000-000000000011','Other'
);

-- If the final audit write fails, rollback must remove the crate/product too.
create function pg_temp.reject_assortment_request()
 returns trigger language plpgsql as $fail$
begin
 if new.request_id='89d00000-0000-4000-9000-000000000099'::uuid
 then raise exception 'Injected request audit failure' using errcode='22023';
 end if;
 return new;
end;
$fail$;
create trigger ephemeral_assortment_creation_failure
 after insert on private.legacy_assortment_creation_requests
 for each row execute function pg_temp.reject_assortment_request();

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89d00000-0000-4000-8000-000000000001',true);
do $create_and_replay$
declare v_crate uuid; v_crate_retry uuid; v_product uuid; v_replay uuid;
begin
 v_crate:=public.create_legacy_crate_type(
   '89d00000-0000-4000-9000-000000000021',
   'Walnik crate','NB',20,null);
 v_crate_retry:=public.create_legacy_crate_type(
   '89d00000-0000-4000-9000-000000000021',
   'Walnik crate','NB',20,null);
 if v_crate<>v_crate_retry
    or v_crate='89d00000-0000-4000-9000-000000000021'::uuid then
   raise exception 'Legacy crate retry did not use generated ID';
 end if;
 perform set_config('fixture.legacy_crate',v_crate::text,true);

 -- An actual other business crate ID can be a retry TOKEN without collision.
 if public.create_legacy_crate_type(
  '89d00000-0000-4000-9000-000000000012',
  'Foreign-shaped token','NB',12,null)
  ='89d00000-0000-4000-9000-000000000012'::uuid then
   raise exception 'Foreign crate ID was accepted as a legacy PK';
 end if;
 if (select count(*) from public.crate_types
   where id='89d00000-0000-4000-9000-000000000012')<>0 then
   -- Authenticated RLS must not show foreign crate; NULL/unknown is a failure.
   raise exception 'Legacy caller read a foreign crate';
 end if;
 v_product:=public.create_legacy_product(
    '89d00000-0000-4000-9000-000000000013', -- foreign product ID as TOKEN
    'Original shop drink',null,null,v_crate,20,10000,null,null,500,
    true,'Walnik bottle',null);
 v_replay:=public.create_legacy_product(
    '89d00000-0000-4000-9000-000000000013',
    'Original shop drink',null,null,v_crate,20,10000,null,null,500,
    true,'Walnik bottle',null);
 if v_product<>v_replay
    or v_product='89d00000-0000-4000-9000-000000000013'::uuid then
   raise exception 'Legacy product retry used caller-selected PK';
 end if;
 perform set_config('fixture.legacy_product',v_product::text,true);
 if (select count(*) from public.products where id=v_product)<>1 then
   raise exception 'Legacy retry duplicated a product record';
 end if;
 -- Data API direct writes must be unavailable, with AND without an ID.
 begin
   insert into public.products(id,name,bottles_per_crate,
      full_crate_price,bottles_returnable,crate_type_id)
   values('89d00000-0000-4000-9000-000000000013',
     'Probe',20,10000,false,v_crate);
   raise exception 'Direct chosen-PK insert permitted' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
   insert into public.products(name,bottles_per_crate,
      full_crate_price,bottles_returnable,crate_type_id)
   values('Probe default PK',20,10000,false,v_crate);
   raise exception 'Direct default-PK insert permitted' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.create_crate_type(
    '89d00000-0000-4000-9000-000000000012',
    'Probe','NB',20,null);
   raise exception 'Old public crate RPC remains executable' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
   perform private.create_crate_type(
    '89d00000-0000-4000-9000-000000000012',
    'Probe','NB',20,null);
   raise exception 'Old private crate RPC remains executable' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.create_legacy_crate_type(
      '89d00000-0000-4000-9000-000000000021',
      'Changed name','NB',20,null);
   raise exception 'Altered crate retry accepted' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
   perform public.create_legacy_product(
      '89d00000-0000-4000-9000-000000000013',
      'Original shop drink',null,null,v_crate,20,11500,null,null,500,
      true,'Walnik bottle',null);
   raise exception 'Altered product retry accepted' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 -- Exact retry after product UPDATE must not revert a newer selling price.
 update public.products set full_crate_price=11000 where id=v_product;
 if public.create_legacy_product(
    '89d00000-0000-4000-9000-000000000013',
    'Original shop drink',null,null,v_crate,20,10000,null,null,500,
    true,'Walnik bottle',null)<>v_product
    or (select full_crate_price from public.products where id=v_product)<>11000 then
   raise exception 'Product retry overwrote the updated price';
 end if;
 begin
  perform public.create_legacy_crate_type(
   '89d00000-0000-4000-9000-000000000099','Bad audit','NB',20,null);
  raise exception 'Crate audit failure did not abort' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.create_legacy_product(
   '89d00000-0000-4000-9000-000000000099','Bad audit',null,null,
   v_crate,20,10000,null,null,null,false,null,null);
  raise exception 'Product audit failure did not abort' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
end;
$create_and_replay$;
reset role;
do $audit_count$
begin
 if (select count(*) from private.legacy_assortment_creation_requests
   where owner_id='89d00000-0000-4000-8000-000000000001')<>3 then
   raise exception 'Legacy retry duplicated an audit entry';
 end if;
end;
$audit_count$;
do $no_ghosts$
begin
 if exists(select 1 from public.crate_types where name='Bad audit')
    or exists(select 1 from public.products where name='Bad audit')
    or exists(select 1 from private.legacy_assortment_creation_requests
       where request_id='89d00000-0000-4000-9000-000000000099') then
    raise exception 'Failed assortment audit left a ghost record';
 end if;
end;
$no_ghosts$;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89d00000-0000-4000-8000-000000000002',true);
do $nonowner$
begin
 begin
   perform public.create_legacy_crate_type(
       '89d00000-0000-4000-9000-000000000022','Unauthorized','NB',20,null);
   raise exception 'Nonowner created a crate' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
   perform public.create_legacy_product(
       '89d00000-0000-4000-9000-000000000023','Unauthorized',null,null,
       current_setting('fixture.legacy_crate')::uuid,20,10000,null,null,null,
       false,null,null);
   raise exception 'Nonowner created a drink' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$nonowner$;
set local role anon;
do $anon$
begin
 begin
  perform public.create_legacy_crate_type(
   gen_random_uuid(),'Anonymous','NB',20,null);
  raise exception 'Anonymous crate create' using errcode='PT001';
 exception when insufficient_privilege then null; end;
 begin
  perform public.create_legacy_product(
    gen_random_uuid(),'Anonymous',null,null,
    gen_random_uuid(),20,10000,null,null,null,false,null,null);
  raise exception 'Anonymous drink create' using errcode='PT001';
 exception when insufficient_privilege then null; end;
end;
$anon$;
reset role;
rollback;
