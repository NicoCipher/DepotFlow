-- Disposable migrated database only. All fixtures and changes roll back.
begin;
insert into public.crate_types(id,name,empty_family,pocket_count) values
 ('b3882166-eedd-5c82-a83f-94a760c1b718','test-crate','same family',12),
 ('cc838680-9610-54b7-b1ca-cdc670a9bbce','other-crate','same family',12),
 ('9e9b4163-a655-5e6b-8f96-65da283f12d3','crate','same family',12);
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000011'), ('00000000-0000-4000-8000-000000000012');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000011');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000011', true);
insert into public.products(id,name,size,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id,bottle_type)
values ('10000000-0000-4000-8000-000000000011','Test Drink','Big',12,12500,true,'b3882166-eedd-5c82-a83f-94a760c1b718','test-bottle');
update public.products set name='Updated drink',full_crate_price=13000,half_crate_price=0 where id='10000000-0000-4000-8000-000000000011';
do $$ declare field text; begin
  if (select name from public.products where id='10000000-0000-4000-8000-000000000011') <> 'Updated drink' then raise exception 'Owner edit failed'; end if;
  if exists(select 1 from public.stock) then raise exception 'Product created stock'; end if;
  begin
    insert into public.products(id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id)
    values ('10000000-0000-4000-8000-000000000011','Duplicate retry',12,0,false,'b3882166-eedd-5c82-a83f-94a760c1b718');
    raise exception 'Duplicate form ID accepted';
  exception when unique_violation then null; end;
  foreach field in array array['full_crate_price','half_crate_price','quarter_crate_price','bottle_price'] loop
    begin
      execute format('update public.products set %I=12525',field);
      raise exception 'Price increment accepted: %',field;
    exception when check_violation then null; end;
    begin
      execute format('update public.products set %I=-50',field);
      raise exception 'Negative price accepted: %',field;
    exception when check_violation then null; end;
  end loop;
  begin
    update public.products set bottles_per_crate=0;
    raise exception 'Zero crate size accepted';
  exception when check_violation then null; end;
  begin
    update public.products set bottle_type=null;
    raise exception 'Returnable bottles without type accepted';
  exception when check_violation then null; end;
  begin
    update public.products set crate_type_id=null;
    raise exception 'Empty crate type accepted';
  exception when not_null_violation then null; end;
  begin
    update public.products set name=' ';
    raise exception 'Empty name accepted';
  exception when check_violation then null; end;
  begin
    delete from public.products;
    raise exception 'Product deletion allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.products set id=gen_random_uuid();
    raise exception 'Product ID update allowed';
  exception when insufficient_privilege then null; end;
  begin
    update public.products set created_at=now();
    raise exception 'Product timestamp update allowed';
  exception when insufficient_privilege then null; end;
end $$;
-- Same name/size is allowed; zero and null prices remain valid.
insert into public.products(name,size,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id)
values ('Updated drink','Big',24,0,false,'cc838680-9610-54b7-b1ca-cdc670a9bbce');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000012', true);
do $$ declare changed integer; begin
  if exists(select 1 from public.products) then raise exception 'Non-owner reads products'; end if;
  begin
    insert into public.products(name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id)
    values ('Intruder',12,0,false,'9e9b4163-a655-5e6b-8f96-65da283f12d3');
    raise exception 'Non-owner inserted product';
  exception when insufficient_privilege then null; end;
  update public.products set name='Intruder' where id='10000000-0000-4000-8000-000000000011';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Non-owner changed product by ID'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform * from public.products;
    raise exception 'Anonymous read allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.products(name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id)
    values ('Anonymous',12,0,false,'9e9b4163-a655-5e6b-8f96-65da283f12d3');
    raise exception 'Anonymous write allowed';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare t text; begin
  foreach t in array array['stock','sales','sale_items','money_owed','deposits','crate_obligations','bottle_obligations','empty_crate_stock','empty_bottle_stock'] loop
    if has_any_column_privilege('authenticated',format('public.%I',t),'INSERT,UPDATE') or has_table_privilege('authenticated',format('public.%I',t),'DELETE,TRUNCATE') then raise exception 'Unrelated write permission: %',t; end if;
  end loop;
  if not (select relrowsecurity from pg_class where oid='public.products'::regclass) then raise exception 'Product RLS disabled'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='owner_read') then raise exception 'Owner read policy lost'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='products' and policyname='owner_update_product' and qual is not null and with_check is not null) then raise exception 'Update policy incomplete'; end if;
end $$;
rollback;
