-- Disposable migrated database only. Fixtures and all mutations roll back.
begin;
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
do $$ begin
  if not public.is_shop_owner() then raise exception 'Owner denied'; end if;
end $$;
insert into public.customers(id,name,phone,business_name,address) values ('10000000-0000-4000-8000-000000000001','Ada','+2348031234567','Ada Shop','Lagos');
update public.customers set name='Ada Okafor', address='Abuja' where id='10000000-0000-4000-8000-000000000001';
do $$ begin
  if (select name from public.customers where id='10000000-0000-4000-8000-000000000001') <> 'Ada Okafor' then raise exception 'Owner edit failed'; end if;
  begin
    insert into public.customers(id,name,phone) values ('10000000-0000-4000-8000-000000000001','Ada','+2348031234567');
    raise exception 'Duplicate submission inserted';
  exception when unique_violation then null; end;
  begin
    insert into public.customers(name,phone) values ('Bad phone','not a number');
    raise exception 'Invalid phone accepted';
  exception when check_violation then null; end;
  begin
    update public.customers set name='  ';
    raise exception 'Blank name accepted';
  exception when check_violation then null; end;
  begin
    update public.customers set id=gen_random_uuid();
    raise exception 'ID update permitted';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.customers;
    raise exception 'Delete permitted';
  exception when insufficient_privilege then null; end;
  begin
    update public.stock set total_bottles=0;
    raise exception 'Stock writes permitted';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.customers) <> 1 then raise exception 'Unexpected duplicate'; end if;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
do $$ declare changed integer; begin
  if public.is_shop_owner() then raise exception 'Non-owner authorized'; end if;
  if exists (select 1 from public.customers) then raise exception 'Customer leaked'; end if;
  begin
    insert into public.customers(name,phone) values ('Intruder','+2348031234567');
    raise exception 'Non-owner insert permitted';
  exception when insufficient_privilege then null; end;
  update public.customers set name='Intruder' where id='10000000-0000-4000-8000-000000000001';
  get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'Non-owner ID edit permitted'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    perform * from public.customers;
    raise exception 'Anonymous read permitted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.is_shop_owner();
    raise exception 'Anonymous RPC permitted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare t record; begin
  for t in select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'
  loop
    if not t.relrowsecurity then raise exception 'RLS missing on %',t.relname; end if;
    if t.relname <> 'customers' and has_table_privilege('authenticated',format('public.%I',t.relname),'INSERT,UPDATE,DELETE') then raise exception 'Unexpected writes on %',t.relname; end if;
  end loop;
end $$;
rollback;
