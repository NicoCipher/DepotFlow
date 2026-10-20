-- M2f-3: close legacy-owner direct SELECT access to another business's
-- financial, deposit, obligation, history and profile rows.
-- This does not enable second-business sales or mutations.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $financial_read_scope$
declare
  v_table text;
  v_policy text;
  v_expression text;
  v_count integer:=0;
begin
  for v_table,v_policy in
    select x.table_name,x.policy_name
    from (values
      ('bottle_deposit_price','owner_read'),
      ('bottle_obligations','owner_read'),
      ('crate_deposit_prices','owner_read'),
      ('crate_obligations','owner_read'),
      ('crate_swap_rules','owner_read'),
      ('customer_opening_balances','owner_read'),
      ('customer_payments','owner_read'),
      ('deposits','owner_read'),
      ('money_owed','owner_read'),
      ('product_cost_history','owner_read'),
      ('product_selling_price_history','owner_read'),
      ('sale_empty_bottle_returns','owner_read'),
      ('sale_empty_crate_returns','owner_read'),
      ('sale_empty_decisions','owner_empty_choices'),
      ('sale_items','owner_read'),
      ('sales','owner_read'),
      ('shop_profile','owner_profile')
    ) as x(table_name,policy_name)
  loop
    -- Fail closed if an expected policy or scoped column changes. The name
    -- is an explicit migration allowlist, not caller input.
    if not exists(
      select 1 from pg_catalog.pg_policy pol
      join pg_catalog.pg_class c on c.oid=pol.polrelid
      join pg_catalog.pg_namespace n on n.oid=c.relnamespace
      join pg_catalog.pg_attribute a on a.attrelid=c.oid
      where n.nspname='public' and c.relname=v_table
        and pol.polname=v_policy and pol.polcmd='r'
        and a.attname='business_id' and a.attnum>0 and not a.attisdropped
    ) then
      raise exception 'Expected tenant financial read policy missing: %.%',v_table,v_policy;
    end if;
    v_expression:='private.can_read_legacy_customer(business_id)';
    if v_table in ('product_cost_history','product_selling_price_history') then
      -- Keep the original owner_user_id restriction; do not allow a legacy
      -- business member to see some other actor's price history.
      v_expression:=v_expression || ' and owner_user_id=(select auth.uid())';
    end if;
    execute pg_catalog.format(
      'alter policy %I on public.%I using (%s)',
      v_policy,v_table,v_expression
    );
    v_count:=v_count+1;
  end loop;
  if v_count<>17 then
    raise exception 'Exactly 17 previously global SELECT policies must be scoped';
  end if;
end;
$financial_read_scope$;
commit;
