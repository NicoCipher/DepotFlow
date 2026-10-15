-- Disposable database only. All test records and sale attempts roll back.
begin;

insert into auth.users(id) values
  ('89000000-0000-4000-8000-000000000001'),
  ('89000000-0000-4000-8000-000000000002');
insert into private.shop_owner(user_id)
values ('89000000-0000-4000-8000-000000000001');

insert into public.crate_types(id,name,empty_family,pocket_count)
values ('89000000-0000-4000-9000-000000000010','Goldberg','NB',12);
insert into public.products(id,name,bottles_per_crate,full_crate_price,half_crate_price,quarter_crate_price,bottle_price,bottles_returnable,crate_type_id)
values ('89000000-0000-4000-9000-000000000020','Goldberg',12,12000,6000,3000,1000,false,'89000000-0000-4000-9000-000000000010');
insert into public.stock(product_id,total_bottles)
values ('89000000-0000-4000-9000-000000000020',120);
insert into public.customers(id,name,phone,empties_deposit_required)
values ('89000000-0000-4000-9000-000000000030','Shop customer','08000008900',false);

set local role authenticated;
select set_config('request.jwt.claim.sub','89000000-0000-4000-8000-000000000001',true);

do $lifecycle$
declare
  p uuid:='89000000-0000-4000-9000-000000000020';
  line jsonb;
  sale jsonb;
  replay jsonb;
  stock_before integer;
  sale_before integer;
  err text;
begin
  if (select is_active from public.products where id=p) is distinct from true then
    raise exception 'Newly added drink should be active';
  end if;
  if public.set_shop_drink_active(p,false,true) is distinct from false then
    raise exception 'Remove failed';
  end if;
  -- Repeating the same intent after a lost response must be harmless.
  perform public.set_shop_drink_active(p,false,true);
  if (select total_bottles from public.stock where product_id=p)<>120 then
    raise exception 'Removing drink changed physical stock';
  end if;
  if (select count(*) from public.products where id=p)<>1 then
    raise exception 'Removing drink deleted historical identity';
  end if;
  line:=jsonb_build_object(
    'productId',p,'quantity',jsonb_build_object('crates',1,'fraction',0,'bottles',0),
    'cratesTaken',0,'returnedCrates',0,'returnedBottles',0,
    'expected',jsonb_build_object(
      'full',12000,'half',6000,'quarter',3000,'bottle',1000,'size',12,
      'crate','89000000-0000-4000-9000-000000000010',
      'returnable',false,'bottleType',null,'stock',120)
  );
  begin
    perform public.save_sale_v2(
      '89000000-0000-4000-9000-000000000040',
      '89000000-0000-4000-9000-000000000030',
      '2026-10-15',12000,jsonb_build_array(line),'[]'::jsonb,'[]'::jsonb,'cash'
    );
    raise exception 'Sale of removed drink was accepted' using errcode='PT001';
  exception when sqlstate '22023' then
    get stacked diagnostics err=message_text;
    if err not like '%removed from the shop%' then
      raise exception 'Wrong removal error: %',err;
    end if;
  end;
  if (select total_bottles from public.stock where product_id=p)<>120 then
    raise exception 'Failed sale still deducted stock';
  end if;
  if (select count(*) from public.sales)<>0 then
    raise exception 'Failed removed sale committed a sale';
  end if;
  if public.set_shop_drink_active(p,true,false) is distinct from true then
    raise exception 'Restore failed';
  end if;
  sale:=public.save_sale_v2(
    '89000000-0000-4000-9000-000000000041',
    '89000000-0000-4000-9000-000000000030',
    '2026-10-15',12000,jsonb_build_array(line),'[]'::jsonb,'[]'::jsonb,'cash'
  );
  if (sale->>'id') is null then raise exception 'Restore did not allow sale'; end if;
  if (select total_bottles from public.stock where product_id=p)<>108 then
    raise exception 'Restored sale stock incorrect';
  end if;
  perform public.set_shop_drink_active(p,false,true);
  replay:=public.save_sale_v2(
    '89000000-0000-4000-9000-000000000041',
    '89000000-0000-4000-9000-000000000030',
    '2026-10-15',12000,jsonb_build_array(line),'[]'::jsonb,'[]'::jsonb,'cash'
  );
  if replay->>'id' is distinct from sale->>'id'
    or (select total_bottles from public.stock where product_id=p)<>108 then
    raise exception 'Removing drink broke saved-sale idempotent recovery';
  end if;
end $lifecycle$;

-- A second logged-in user cannot modify assortment status.
select set_config('request.jwt.claim.sub','89000000-0000-4000-8000-000000000002',true);
do $denied$
begin
  begin
    perform public.set_shop_drink_active(
      '89000000-0000-4000-9000-000000000020',true,false);
    raise exception 'Non-owner modified drink availability' using errcode='PT001';
  exception when insufficient_privilege then null;
  end;
end $denied$;

reset role;
do $security$
begin
  if has_function_privilege('anon','public.set_shop_drink_active(uuid,boolean,boolean)','EXECUTE') then
    raise exception 'Anonymous shop drink changes are exposed';
  end if;
  if not (select relrowsecurity from pg_class where oid='public.products'::regclass) then
    raise exception 'Product RLS disabled';
  end if;
end $security$;
rollback;
