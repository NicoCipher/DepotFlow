-- Run against an empty disposable database after the full migration chain.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000091');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000091');
insert into public.customers(id,name,phone)
values ('10000000-0000-4000-8000-000000000091','Partial price customer','08000000091');
insert into public.crate_types(id,name,empty_family,pocket_count)
values ('20000000-0000-4000-8000-000000000091','Exact partial crate','Test',12);
insert into public.products(id,name,bottles_per_crate,full_crate_price,half_crate_price,quarter_crate_price,bottle_price,bottles_returnable,crate_type_id)
values ('30000000-0000-4000-8000-000000000091','Partial price drink',12,14500,null,null,null,false,'20000000-0000-4000-8000-000000000091');
insert into public.stock(product_id,total_bottles)
values ('30000000-0000-4000-8000-000000000091',100);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000091',true);

do $$
declare
  line jsonb;
  result jsonb;
begin
  -- With no overrides, quarter, half and three-quarter use exact full-price shares.
  line:=jsonb_build_object('productId','30000000-0000-4000-8000-000000000091',
    'quantity',jsonb_build_object('crates',0,'fraction',1,'bottles',0),
    'returnedCrates',0,'returnedBottles',0,
    'expected',jsonb_build_object('full',14500,'half',null,'quarter',null,'bottle',null,
      'size',12,'crate','20000000-0000-4000-8000-000000000091','returnable',false,'bottleType',null,'stock',100));
  result:=public.save_sale('40000000-0000-4000-8000-000000000091','10000000-0000-4000-8000-000000000091','2026-09-23',0,jsonb_build_array(line));
  if (result->>'total')::integer<>3625 then raise exception 'Derived quarter wrong: %',result; end if;

  line:=jsonb_set(line,'{quantity,fraction}','2'::jsonb);
  line:=jsonb_set(line,'{expected,stock}','97'::jsonb);
  result:=public.save_sale('40000000-0000-4000-8000-000000000092','10000000-0000-4000-8000-000000000091','2026-09-23',0,jsonb_build_array(line));
  if (result->>'total')::integer<>7250 then raise exception 'Derived half wrong: %',result; end if;

  line:=jsonb_set(line,'{quantity,fraction}','3'::jsonb);
  line:=jsonb_set(line,'{expected,stock}','91'::jsonb);
  result:=public.save_sale('40000000-0000-4000-8000-000000000093','10000000-0000-4000-8000-000000000091','2026-09-23',0,jsonb_build_array(line));
  if (result->>'total')::integer<>10875 then raise exception 'Derived three-quarter wrong: %',result; end if;

  -- Existing full-crate pricing remains unchanged.
  line:=jsonb_set(line,'{quantity}',jsonb_build_object('crates',1,'fraction',0,'bottles',0));
  line:=jsonb_set(line,'{expected,stock}','82'::jsonb);
  result:=public.save_sale('40000000-0000-4000-8000-000000000094','10000000-0000-4000-8000-000000000091','2026-09-23',0,jsonb_build_array(line));
  if (result->>'total')::integer<>14500 then raise exception 'Full crate changed: %',result; end if;

  -- Loose bottles remain independently priced and cannot fall back to crate price.
  line:=jsonb_set(line,'{quantity}',jsonb_build_object('crates',0,'fraction',0,'bottles',1));
  line:=jsonb_set(line,'{expected,stock}','70'::jsonb);
  begin
    perform public.save_sale('40000000-0000-4000-8000-000000000095','10000000-0000-4000-8000-000000000091','2026-09-23',0,jsonb_build_array(line));
    raise exception 'Loose bottle used derived crate price';
  exception when invalid_parameter_value then null; end;
  if exists(select 1 from public.sales where request_id='40000000-0000-4000-8000-000000000095') then raise exception 'Rejected bottle sale persisted'; end if;
end $$;

update public.products set half_crate_price=8000,quarter_crate_price=4000
where id='30000000-0000-4000-8000-000000000091';

do $$
declare
  line jsonb;
  result jsonb;
begin
  line:=jsonb_build_object('productId','30000000-0000-4000-8000-000000000091',
    'quantity',jsonb_build_object('crates',0,'fraction',3,'bottles',0),
    'returnedCrates',0,'returnedBottles',0,
    'expected',jsonb_build_object('full',14500,'half',8000,'quarter',4000,'bottle',null,
      'size',12,'crate','20000000-0000-4000-8000-000000000091','returnable',false,'bottleType',null,'stock',70));
  result:=public.save_sale('40000000-0000-4000-8000-000000000096','10000000-0000-4000-8000-000000000091','2026-09-23',0,jsonb_build_array(line));
  if (result->>'total')::integer<>12000 then raise exception 'Explicit overrides ignored: %',result; end if;

  -- The database rejects an old authoritative snapshot and writes nothing.
  update public.products set full_crate_price=15000 where id='30000000-0000-4000-8000-000000000091';
  line:=jsonb_set(line,'{expected,stock}','61'::jsonb);
  begin
    perform public.save_sale('40000000-0000-4000-8000-000000000097','10000000-0000-4000-8000-000000000091','2026-09-23',0,jsonb_build_array(line));
    raise exception 'Stale price snapshot accepted';
  exception when invalid_parameter_value then null; end;
  if exists(select 1 from public.sales where request_id='40000000-0000-4000-8000-000000000097') then raise exception 'Stale price rejection wrote a sale'; end if;
end $$;

rollback;
