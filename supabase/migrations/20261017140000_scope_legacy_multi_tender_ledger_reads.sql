-- M2f-5: production gained a new mixed-payment child ledger AFTER the
-- original legacy read-gate plan was written. Read access to these immutable
-- Cash/Transfer/POS lines must inherit the EXACT business of the saved sale,
-- never a global is_shop_owner() grant. The new-business sales path remains
-- deliberately disabled; this migration enables no new payments.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $scope_mixed_finance$
declare
  v_policy_count integer;
  v_grant boolean;
begin
  if pg_catalog.to_regclass('public.sale_tender_legs') is null
    or pg_catalog.to_regprocedure('private.can_read_legacy_customer(uuid)') is null
    or pg_catalog.to_regclass('public.sales') is null then
    raise exception 'M2 mixed-ledger tenant prerequisites missing';
  end if;
  select count(*) into v_policy_count
  from pg_catalog.pg_policy pol
  where pol.polrelid='public.sale_tender_legs'::regclass
    and pol.polname='owner_read' and pol.polcmd='r';
  if v_policy_count<>1 then
    raise exception 'Expected one sale_tender_legs owner_read policy, found %',
      v_policy_count;
  end if;
  select pg_catalog.has_table_privilege(
    'authenticated','public.sale_tender_legs','SELECT'
  ) into v_grant;
  if not v_grant then
    raise exception 'Mixed ledger SELECT grant missing';
  end if;
end;
$scope_mixed_finance$;

-- A row is visible only when its immutable sale_id resolves to a legacy sale
-- owned by the verified active original business. Filtering directly on
-- the SALE is mandatory because this table has no business_id of its own.
alter policy owner_read on public.sale_tender_legs
  using (
    exists(
      select 1 from public.sales s
      where s.id=sale_id
        and private.can_read_legacy_customer(s.business_id)
    )
  );

-- Future new-business sales need a reviewed business-aware tender path
-- rather than enabling it by OR-ing ownership predicates onto legacy RPCs.
commit;
