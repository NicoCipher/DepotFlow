-- Run in a disposable migrated database. All fixtures roll back.
begin;
insert into public.crate_types(id,name,empty_family,pocket_count) values
 ('abf7e48b-868d-517e-bc34-e2ecd174a09f','test','same family',12);
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000021'), ('00000000-0000-4000-8000-000000000022');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000021');
insert into public.products(id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id) values
 ('10000000-0000-4000-8000-000000000021','Recorded',12,0,false,'abf7e48b-868d-517e-bc34-e2ecd174a09f'),
 ('10000000-0000-4000-8000-000000000022','Unrecorded',24,0,false,'abf7e48b-868d-517e-bc34-e2ecd174a09f'),
 ('10000000-0000-4000-8000-000000000023','Zero',12,0,false,'abf7e48b-868d-517e-bc34-e2ecd174a09f');
insert into public.stock(product_id,total_bottles) values
 ('10000000-0000-4000-8000-000000000021',29),
 ('10000000-0000-4000-8000-000000000023',0);
do $$ begin
  begin
    update public.stock set total_bottles=-1;
    raise exception 'Negative stock accepted';
  exception when check_violation then null; end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000021',true);
do $$ begin
  if (select count(*) from public.products p left join public.stock s on p.id=s.product_id) <> 3 then raise exception 'Products missing from stock view'; end if;
  if (select count(*) from public.products p left join public.stock s on p.id=s.product_id where s.total_bottles is null) <> 1 then raise exception 'Missing stock not preserved'; end if;
  if (select count(*) from public.stock where total_bottles=0) <> 1 then raise exception 'Zero stock not readable'; end if;
  if (select total_bottles from public.stock where product_id='10000000-0000-4000-8000-000000000021') <> 29 then raise exception 'Owner stock read failed'; end if;
  begin
    update public.stock set total_bottles=0;
    raise exception 'Owner stock update allowed';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.stock(product_id,total_bottles) values ('10000000-0000-4000-8000-000000000022',12);
    raise exception 'Owner stock insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.stock;
    raise exception 'Owner stock deletion allowed';
  exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000022',true);
do $$ begin
  if exists(select 1 from public.stock) then raise exception 'Non-owner can read stock'; end if;
  if exists(select 1 from public.products p left join public.stock s on p.id=s.product_id) then raise exception 'Non-owner can read stock cards'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform * from public.stock;
    raise exception 'Anonymous stock read allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
