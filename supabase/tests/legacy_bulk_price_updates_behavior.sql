-- Rollback-only behavioral tests for the legacy bulk-price RPC.
-- Runs only in the disposable PostgreSQL 17 database used by CI.
begin;

insert into auth.users(id) values
 ('b8c00000-0000-4000-8000-000000000021'),
 ('b8c00000-0000-4000-8000-000000000022');
insert into private.shop_owner(user_id)
 values ('b8c00000-0000-4000-8000-000000000021');
select private.link_legacy_shop_business();

insert into public.crate_types(id,name,empty_family,pocket_count)
 values ('b8c00000-0000-4000-8000-000000000031','Bulk price test crate','NB',12);

insert into public.products
 (id,name,bottles_per_crate,full_crate_price,bottle_price,bottles_returnable,
  crate_type_id,catalogue_product_id)
select 'b8c00000-0000-4000-8000-000000000041','Bulk Goldberg',12,10000,900,false,
       'b8c00000-0000-4000-8000-000000000031',id
from public.product_catalogue where name='Goldberg';
insert into public.products
 (id,name,bottles_per_crate,full_crate_price,bottle_price,bottles_returnable,
  crate_type_id,catalogue_product_id)
select 'b8c00000-0000-4000-8000-000000000042','Bulk Trophy',12,9000,800,false,
       'b8c00000-0000-4000-8000-000000000031',id
from public.product_catalogue where name='Trophy';

insert into public.product_cost_history(owner_user_id,catalogue_product_id,cost_price,effective_on)
select 'b8c00000-0000-4000-8000-000000000021',id,8000,
       (now() at time zone 'Africa/Lagos')::date
from public.product_catalogue where name='Goldberg';
insert into public.product_cost_history(owner_user_id,catalogue_product_id,cost_price,effective_on)
select 'b8c00000-0000-4000-8000-000000000021',id,7000,
       (now() at time zone 'Africa/Lagos')::date
from public.product_catalogue where name='Trophy';

-- Match the exact reviewed legacy-owner activation path in the tenancy tests.
select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate_tenant_fks$
declare r record; n integer:=0;
begin
  for r in
    select ns.nspname as schema_name, c.relname as table_name, k.conname
    from pg_constraint k
    join pg_class c on c.oid=k.conrelid
    join pg_namespace ns on ns.oid=c.relnamespace
    join private.legacy_scope_tables() tab
      on tab.schema_name=ns.nspname and tab.table_name=c.relname
    where k.contype='f' and left(k.conname,7)='tenant_'
  loop
    execute format('alter table %I.%I validate constraint %I',
                   r.schema_name,r.table_name,r.conname);
    n:=n+1;
  end loop;
  if n<>31 then raise exception 'Expected 31 tenant FKs, got %',n; end if;
end;
$validate_tenant_fks$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

-- Keep the owner and catalogue IDs available to each assertion without
-- relying on seeded UUID ordering.
set local role authenticated;
select set_config('request.jwt.claim.sub','b8c00000-0000-4000-8000-000000000021',true);

do $bulk_price_behavior$
declare
  v_goldberg_catalogue uuid;
  v_trophy_catalogue uuid;
  v_payload jsonb;
  v_result jsonb;
  v_retry jsonb;
  v_history_before bigint;
  v_cost_before bigint;
begin
  select id into strict v_goldberg_catalogue from public.product_catalogue where name='Goldberg';
  select id into strict v_trophy_catalogue from public.product_catalogue where name='Trophy';

  -- A two-item batch with a stale second item must roll back the first item,
  -- including its trigger-generated selling-price history.
  select count(*) into v_history_before
  from public.product_selling_price_history where source='product_edit';
  select count(*) into v_cost_before from public.product_cost_history;
  v_payload:=jsonb_build_array(
    jsonb_build_object(
      'product_id','b8c00000-0000-4000-8000-000000000041',
      'change_selling',true,'change_cost',false,
      'expected_full_crate_price',10000,'new_full_crate_price',10500,
      'expected_bottle_price',900,'new_bottle_price',950,
      'catalogue_product_id',null,'expected_cost_price',null,'new_cost_price',null
    ),
    jsonb_build_object(
      'product_id','b8c00000-0000-4000-8000-000000000042',
      'change_selling',true,'change_cost',false,
      'expected_full_crate_price',8500,'new_full_crate_price',9500,
      'expected_bottle_price',800,'new_bottle_price',850,
      'catalogue_product_id',null,'expected_cost_price',null,'new_cost_price',null
    )
  );
  begin
    perform public.update_legacy_product_prices(
      'b8c00000-0000-4000-8000-000000000051',v_payload);
    raise exception 'Stale second item unexpectedly accepted';
  exception when serialization_failure then null;
  end;
  if (select full_crate_price from public.products
      where id='b8c00000-0000-4000-8000-000000000041')<>10000
     or (select bottle_price from public.products
         where id='b8c00000-0000-4000-8000-000000000041')<>900
     or (select count(*) from public.product_selling_price_history
         where source='product_edit')<>v_history_before
     or (select count(*) from public.product_cost_history)<>v_cost_before then
    raise exception 'Failed batch partially changed prices or history';
  end if;

  -- A valid mixed selling-price + buying-cost batch commits once.
  v_payload:=jsonb_build_array(
    jsonb_build_object(
      'product_id','b8c00000-0000-4000-8000-000000000041',
      'change_selling',true,'change_cost',true,
      'expected_full_crate_price',10000,'new_full_crate_price',10500,
      'expected_bottle_price',900,'new_bottle_price',950,
      'catalogue_product_id',v_goldberg_catalogue,
      'expected_cost_price',8000,'new_cost_price',8200
    )
  );
  v_result:=public.update_legacy_product_prices(
    'b8c00000-0000-4000-8000-000000000052',v_payload);
  if v_result->>'saved'<>'true' or (v_result->>'count')::integer<>1
     or (select full_crate_price from public.products
         where id='b8c00000-0000-4000-8000-000000000041')<>10500
     or (select bottle_price from public.products
         where id='b8c00000-0000-4000-8000-000000000041')<>950
     or not exists(select 1 from public.product_cost_history
       where catalogue_product_id=v_goldberg_catalogue and cost_price=8200
         and business_id=(select business_id from public.products
                          where id='b8c00000-0000-4000-8000-000000000041'))
     or not exists(select 1 from public.product_selling_price_history
       where catalogue_product_id=v_goldberg_catalogue and selling_price=10500
         and source='product_edit') then
    raise exception 'Valid batch did not update prices and append both histories';
  end if;

  -- Exact retry returns the same result and does not duplicate either history.
  select count(*) into v_history_before
  from public.product_selling_price_history where source='product_edit';
  select count(*) into v_cost_before from public.product_cost_history;
  v_retry:=public.update_legacy_product_prices(
    'b8c00000-0000-4000-8000-000000000052',v_payload);
  if v_retry is distinct from v_result
     or (select count(*) from public.product_selling_price_history
         where source='product_edit')<>v_history_before
     or (select count(*) from public.product_cost_history)<>v_cost_before then
    raise exception 'Exact retry changed result or duplicated price history';
  end if;

  -- A request UUID cannot be reused with different content.
  begin
    perform public.update_legacy_product_prices(
      'b8c00000-0000-4000-8000-000000000052',
      jsonb_set(v_payload,'{0,new_full_crate_price}','11000'::jsonb));
    raise exception 'Changed payload reused an existing request UUID';
  exception when invalid_parameter_value then null;
  end;

  -- Stale expected values must fail without modifying current values.
  begin
    perform public.update_legacy_product_prices(
      'b8c00000-0000-4000-8000-000000000053',
      jsonb_set(v_payload,'{0,expected_full_crate_price}','10000'::jsonb));
    raise exception 'Stale price unexpectedly accepted';
  exception when serialization_failure then null;
  end;
  if (select full_crate_price from public.products
      where id='b8c00000-0000-4000-8000-000000000041')<>10500 then
    raise exception 'Stale request changed the current selling price';
  end if;

  -- Duplicate products in one batch must be rejected before any writes.
  begin
    perform public.update_legacy_product_prices(
      'b8c00000-0000-4000-8000-000000000054',
      v_payload||v_payload);
    raise exception 'Duplicate product in one batch was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$bulk_price_behavior$;

-- Another authenticated user must fail the owner guard and cannot write.
select set_config('request.jwt.claim.sub','b8c00000-0000-4000-8000-000000000022',true);
do $non_owner_denied$
begin
  begin
    perform public.update_legacy_product_prices(
      'b8c00000-0000-4000-8000-000000000055',
      '[{"product_id":"b8c00000-0000-4000-8000-000000000041","change_selling":true,"expected_full_crate_price":10500,"new_full_crate_price":11000}]'::jsonb);
    raise exception 'Non-owner updated a legacy product';
  exception when insufficient_privilege then null;
  end;
  if (select full_crate_price from public.products
      where id='b8c00000-0000-4000-8000-000000000041')<>10500 then
    raise exception 'Non-owner changed the current price';
  end if;
end;
$non_owner_denied$;

reset role;
set local role anon;
do $anonymous_denied$
begin
  begin
    perform public.update_legacy_product_prices(
      'b8c00000-0000-4000-8000-000000000056','[]'::jsonb);
    raise exception 'Anonymous user executed the bulk-price RPC';
  exception when insufficient_privilege then null;
  end;
end;
$anonymous_denied$;
reset role;

rollback;
