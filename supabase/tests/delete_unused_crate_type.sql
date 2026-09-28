begin;

insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000701'),
  ('00000000-0000-4000-8000-000000000702');
insert into private.shop_owner(user_id) values
  ('00000000-0000-4000-8000-000000000701');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000701',true);

select public.create_crate_type('50000000-0000-4000-8000-000000000701','Unused','Other',12,'test');
select public.create_crate_type('50000000-0000-4000-8000-000000000702','Product crate','Other',12,'test');
select public.create_crate_type('50000000-0000-4000-8000-000000000703','Swap crate','Other',12,'test');
select public.create_crate_type('50000000-0000-4000-8000-000000000704','Counted crate','Other',12,'test');

-- Legacy records follow the same rule: an unused one can be removed, but a
-- historical reference keeps the record even when no current product uses it.
reset role;
insert into public.crate_types(id,name,is_legacy) values
  ('50000000-0000-4000-8000-000000000705','Unused old type',true),
  ('50000000-0000-4000-8000-000000000706','Old counted type',true);
insert into public.empty_crate_stock(crate_type_id,quantity)
values ('50000000-0000-4000-8000-000000000706',0);
set local role authenticated;

insert into public.products(id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id)
values ('10000000-0000-4000-8000-000000000701','Test drink',12,12000,false,
        '50000000-0000-4000-8000-000000000702');
select public.set_crate_swap_rules(
  '50000000-0000-4000-8000-000000000703',
  array['50000000-0000-4000-8000-000000000702'::uuid]
);

reset role;
insert into public.empty_crate_stock(crate_type_id,quantity)
values ('50000000-0000-4000-8000-000000000704',0);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000701',true);

select public.delete_unused_crate_type('50000000-0000-4000-8000-000000000701');
select public.delete_unused_crate_type('50000000-0000-4000-8000-000000000705');
do $$ begin
  if exists(select 1 from public.crate_types where id='50000000-0000-4000-8000-000000000701') then
    raise exception 'Unused crate type was not deleted';
  end if;
  if exists(select 1 from public.crate_types where id='50000000-0000-4000-8000-000000000705') then
    raise exception 'Unused legacy crate type was not deleted';
  end if;
  begin
    perform public.delete_unused_crate_type('50000000-0000-4000-8000-000000000706');
    raise exception 'Historical legacy crate type was deleted';
  exception when foreign_key_violation then null; end;
  begin
    perform public.delete_unused_crate_type('50000000-0000-4000-8000-000000000702');
    raise exception 'Product crate was deleted';
  exception when foreign_key_violation then null; end;
  begin
    perform public.delete_unused_crate_type('50000000-0000-4000-8000-000000000703');
    raise exception 'Swap crate was deleted';
  exception when foreign_key_violation then null; end;
  begin
    perform public.delete_unused_crate_type('50000000-0000-4000-8000-000000000704');
    raise exception 'Counted crate was deleted';
  exception when foreign_key_violation then null; end;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000702',true);
do $$ begin
  begin
    perform public.delete_unused_crate_type('50000000-0000-4000-8000-000000000702');
    raise exception 'Non-owner deleted crate type';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
