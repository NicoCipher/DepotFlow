-- M2a contract: every operational table gets a nullable and unprivileged
-- business_id, foreign keyed to the PRIVATE business identity registry.
-- Must NOT be used as proof of per-tenant access until backfill and M3.
begin;

do $$
declare
  rec record;
  rel_oid oid;
  att_no smallint;
  total integer := 0;
begin
  for rec in select * from (values
    ('public','bottle_deposit_price'),
    ('public','bottle_obligations'),
    ('public','crate_deposit_prices'),
    ('public','crate_obligations'),
    ('public','crate_swap_rules'),
    ('public','crate_types'),
    ('public','customer_opening_balances'),
    ('public','customer_payments'),
    ('public','customers'),
    ('public','deposits'),
    ('public','empty_bottle_stock'),
    ('public','empty_crate_movements'),
    ('public','empty_crate_stock'),
    ('public','money_owed'),
    ('public','product_cost_history'),
    ('public','product_selling_price_history'),
    ('public','products'),
    ('public','sale_empty_bottle_returns'),
    ('public','sale_empty_crate_returns'),
    ('public','sale_empty_decisions'),
    ('public','sale_items'),
    ('public','sales'),
    ('public','shop_profile'),
    ('public','stock'),
    ('public','stock_movements'),
    ('private','confirmed_selling_prices'),
    ('private','customer_empty_returns'),
    ('private','held_empty_collections'),
    ('private','stock_receipts')
  ) as t(s,n) loop
    rel_oid := to_regclass(format('%I.%I', rec.s, rec.n));
    if rel_oid is null then
      raise exception 'Expected tenant-owned table missing: %.%',rec.s,rec.n;
    end if;
    select attnum into att_no from pg_attribute
    where attrelid=rel_oid and attname='business_id' and not attisdropped;
    if att_no is null then
      raise exception 'Table %.% has no business_id',rec.s,rec.n;
    end if;
    if exists (select 1 from pg_attribute
      where attrelid=rel_oid and attnum=att_no and (attnotnull or atthasdef)) then
      raise exception 'M2a must not require or default %.%.business_id',rec.s,rec.n;
    end if;
    if not exists (select 1 from pg_constraint
      where conrelid=rel_oid and contype='f'
        and confrelid='private.businesses'::regclass
        and conkey=array[att_no]::smallint[]) then
      raise exception 'Missing business FK: %.%',rec.s,rec.n;
    end if;
    if has_column_privilege('authenticated',rel_oid,att_no,'UPDATE')
       or has_column_privilege('authenticated',rel_oid,att_no,'INSERT')
       or has_column_privilege('anon',rel_oid,att_no,'UPDATE')
       or has_column_privilege('anon',rel_oid,att_no,'INSERT') then
      raise exception 'Client can forge business_id on %.%',rec.s,rec.n;
    end if;
    total := total + 1;
  end loop;
  if total <> 29 then
    raise exception 'Expected exactly 29 tenant-owned tables; got %',total;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='product_catalogue'
      and column_name='business_id') then
    raise exception 'Global product catalogue was incorrectly tenant scoped';
  end if;
  if (select relrowsecurity from pg_class
       where oid='public.customers'::regclass) is not true
     or (select relrowsecurity from pg_class
       where oid='public.sales'::regclass) is not true
     or (select relrowsecurity from pg_class
       where oid='public.stock'::regclass) is not true then
    raise exception 'Original app RLS was inadvertently disabled';
  end if;
end $$;

-- The old system still recognizes *only* the manually enrolled owner.
insert into auth.users(id)
values('89000000-0000-4000-8000-000000000001'),
      ('89000000-0000-4000-8000-000000000002');
insert into private.shop_owner(user_id)
values('89000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claim.sub',
  '89000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
begin
  if not public.is_shop_owner() then
    raise exception 'M2a broke the legacy owner gate';
  end if;
end $$;
reset role;

select set_config('request.jwt.claim.sub',
  '89000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $$
begin
  if public.is_shop_owner() then
    raise exception 'M2a accidentally enabled a second owner';
  end if;
end $$;
reset role;

rollback;
