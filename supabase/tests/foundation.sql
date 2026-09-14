-- Run on a migrated disposable database as an administrator; all fixtures roll back.
begin;
insert into public.crate_types(id,name,empty_family,pocket_count) values
 ('b3882166-eedd-5c82-a83f-94a760c1b718','test-crate','same family',12);
insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
insert into private.shop_owner(user_id) values ('00000000-0000-0000-0000-000000000001');
insert into public.products(id, name, bottles_per_crate, full_crate_price, bottles_returnable, crate_type_id, bottle_type)
values ('10000000-0000-0000-0000-000000000001', 'Test Drink', 12, 12000, true, 'b3882166-eedd-5c82-a83f-94a760c1b718', 'test-bottle');
insert into public.stock values ('10000000-0000-0000-0000-000000000001', 12);
insert into public.customers(id, name, phone) values ('20000000-0000-0000-0000-000000000001', 'Test Customer', '08000000000');
insert into public.sales(id, customer_id, total_amount, paid_amount)
values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 86500, 70000);
insert into public.sale_items(sale_id, product_id, product_name, total_bottles, bottles_per_crate, line_total, bottles_returnable, crate_type_id, bottle_type)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Test Drink', 30, 12, 30000, true, 'b3882166-eedd-5c82-a83f-94a760c1b718', 'test-bottle');
do $$
begin
  if exists (select 1 from public.sale_items where crates_out <> 2 or returnable_bottles_out <> 30) then
    raise exception 'Incorrect fractional-crate obligations';
  end if;
  begin
    update public.stock set total_bottles = -1;
    raise exception 'Negative stock accepted';
  exception when check_violation then null;
  end;
  begin
    insert into private.shop_owner(user_id) values ('00000000-0000-0000-0000-000000000002');
    raise exception 'Second owner accepted';
  exception when unique_violation then null;
  end;
  begin
    update public.sales set paid_amount = total_amount + 1;
    raise exception 'Overpayment accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.deposits values ('20000000-0000-0000-0000-000000000001', -1);
    raise exception 'Negative deposit accepted';
  exception when check_violation then null;
  end;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$
begin
  if (select count(*) from public.products) <> 1 then raise exception 'Owner cannot read'; end if;
  begin
    update public.stock set total_bottles = 0;
    raise exception 'Direct API write allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update private.shop_owner set user_id = '00000000-0000-0000-0000-000000000002';
    raise exception 'Owner configuration writable';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
do $$
begin
  if exists (select 1 from public.products) then raise exception 'Non-owner can read'; end if;
  if exists (select 1 from public.customers) then raise exception 'Non-owner can read customers'; end if;
  if exists (select 1 from public.sales) then raise exception 'Non-owner can read sales'; end if;
end $$;
reset role;
do $$
declare t record;
begin
  for t in select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r'
  loop
    if not t.relrowsecurity then raise exception 'RLS missing: %', t.relname; end if;
    if has_table_privilege('anon', format('public.%I', t.relname), 'SELECT') then raise exception 'Anonymous read: %', t.relname; end if;
    if has_table_privilege('authenticated', format('public.%I', t.relname), 'INSERT,UPDATE,DELETE') then raise exception 'API writes: %', t.relname; end if;
  end loop;
end $$;
rollback;
