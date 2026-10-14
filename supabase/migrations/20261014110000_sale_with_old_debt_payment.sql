begin;

-- Receipt facts are frozen with the same transaction that saves the sale.
-- A null snapshot denotes a sale created before this feature (never backfill
-- from a customer's current balance, which may have changed).
alter table public.sales add column account_receipt jsonb;

-- Align the still-supported direct sale RPC with the new checkout lock order.
-- This entry point remains accessible for in-flight forms and callers that
-- have not yet switched to the combined checkout RPC.
create or replace function public.save_sale_v2(
  p_request_id uuid,p_customer_id uuid,p_business_date date,p_paid numeric,
  p_lines jsonb,p_returned_crates jsonb,p_returned_bottles jsonb,p_payment_method text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_result jsonb;
  v_method text;
begin
  if auth.uid() is null or not exists (
    select 1 from private.shop_owner where user_id = auth.uid()
  ) then
    raise exception using errcode='42501', message='Owner only';
  end if;
  if p_paid > 0 and (p_payment_method is null or p_payment_method not in ('cash','transfer','pos')) then
    raise exception using errcode='22023',message='Choose how the customer paid.';
  end if;
  -- All public sale entry points acquire the request lock before row locks;
  -- the underlying private saver acquires it again (reentrant).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  -- Customer -> money_owed -> product/stock for every sale entry point.
  perform 1 from public.customers where id = p_customer_id for share;
  perform 1 from public.money_owed where customer_id = p_customer_id for update;
  v_result := private.save_sale_v2(
    p_request_id,p_customer_id,p_business_date,p_paid,
    p_lines,p_returned_crates,p_returned_bottles
  );
  if p_paid > 0 then
    select payment_method into v_method from public.sales where request_id=p_request_id for update;
    if v_method not in ('not_recorded',p_payment_method) then
      raise exception using errcode='22023',message='This sale form was already used with different payment details.';
    end if;
    update public.sales set payment_method=p_payment_method
      where request_id=p_request_id and payment_method='not_recorded';
  end if;
  return v_result;
end;
$$;

-- Atomic checkout: settle an existing debt first, then save today's sale.
-- Both existing RPCs run in one database transaction, so a failed sale rolls
-- back the debt payment as well. A separate payment receipt is issued.
create function public.save_sale_with_old_debt_payment(
  p_request_id uuid,
  p_customer_id uuid,
  p_business_date date,
  p_paid numeric,
  p_lines jsonb,
  p_returned_crates jsonb,
  p_returned_bottles jsonb,
  p_payment_method text,
  p_old_debt_paid numeric
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_payment_request_id uuid;
  v_debt_result jsonb := null;
  v_sale_result jsonb;
  v_old_debt integer;
  v_balance_after integer;
  v_snapshot jsonb;
  v_sale_preexisting boolean := false;
  v_old_debt_reference text;
begin
  if (select auth.uid()) is null or
    not exists (select 1 from private.shop_owner where user_id = (select auth.uid())) then
    raise exception using errcode = '42501', message = 'Owner only';
  end if;
  if p_request_id is null or p_customer_id is null or p_old_debt_paid is null
    or p_old_debt_paid = 'NaN'::numeric or p_old_debt_paid < 0
    or p_old_debt_paid <> trunc(p_old_debt_paid) or p_old_debt_paid > 2147483647 then
    raise exception using errcode = '22023', message = 'Check amount toward previous debt.';
  end if;
  -- Derived request identifier: retries use the exact same immutable ledger entry.
  -- The original sale request ID is never reused as a payment request ID.
  v_payment_request_id := md5('depotflow:old-debt:' || p_request_id::text)::uuid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));

  -- Preserve original receipt values on uncertain-save and duplicate retries.
  select account_receipt into v_snapshot from public.sales where request_id = p_request_id;
  v_sale_preexisting := found;
  -- Consistent lock order for all combined checkouts (debt and no-debt):
  -- customer -> current money owed -> product/stock. Without this, one sale
  -- might hold money_owed and wait for stock while another holds stock and
  -- waits for money_owed, aborting a checkout on a deadlock.
  perform 1 from public.customers where id = p_customer_id for share;
  select amount into v_old_debt from public.money_owed
    where customer_id = p_customer_id for update;
  v_old_debt := coalesce(v_old_debt, 0);

  if p_old_debt_paid > 0 then
    -- Never add a debt payment to an already-committed sale that originally had none.
    if exists (select 1 from public.sales where request_id = p_request_id) and
       not exists (select 1 from public.customer_payments where request_id = v_payment_request_id) then
      raise exception using errcode = '22023',
        message = 'This sale request was already used with different debt payment details.';
    end if;
    -- Must happen BEFORE today's sale increases money_owed, so a debt
    -- collection cannot accidentally settle the sale being recorded now.
    -- The payment RPC locks current money_owed and rejects overpayment.
    v_debt_result := public.record_payment(
      v_payment_request_id, p_customer_id, p_old_debt_paid, p_business_date, p_payment_method
    );
  elsif exists (select 1 from public.customer_payments where request_id = v_payment_request_id) then
    raise exception using errcode = '22023',
      message = 'This sale request was already used with different debt payment details.';
  end if;

  v_sale_result := public.save_sale_v2(
    p_request_id, p_customer_id, p_business_date, p_paid,
    p_lines, p_returned_crates, p_returned_bottles, p_payment_method
  );

  select amount into v_balance_after
    from public.money_owed where customer_id = p_customer_id;
  v_balance_after := coalesce(v_balance_after, 0);

  if not v_sale_preexisting then
    if v_debt_result is not null then
      select receipt_number into v_old_debt_reference
        from public.customer_payments where request_id = v_payment_request_id;
    end if;
    v_snapshot := jsonb_build_object(
      'bd', v_old_debt,
      'saleTotal', (v_sale_result->>'total')::integer,
      'paidSale', p_paid::integer,
      'paidOld', p_old_debt_paid::integer,
      'collected', p_paid::integer + p_old_debt_paid::integer,
      'cd', v_balance_after,
      'debtPaymentReference', v_old_debt_reference
    );
    -- The frozen statement and sale receipt share one verification token.
    update public.sales set account_receipt = v_snapshot
      where id = (v_sale_result->>'id')::uuid and account_receipt is null;
  end if;

  return v_sale_result || jsonb_build_object(
    'oldDebtPaid', p_old_debt_paid::integer,
    'oldDebtPaymentId', v_debt_result->>'id',
    'oldDebtReceiptRequestId', case when v_debt_result is null then null else v_payment_request_id::text end,
    'balanceAfter', coalesce((v_snapshot->>'cd')::integer, v_balance_after)
  );
end;
$$;

revoke all on function public.save_sale_with_old_debt_payment(
  uuid,uuid,date,numeric,jsonb,jsonb,jsonb,text,numeric
) from public,anon;
grant execute on function public.save_sale_with_old_debt_payment(
  uuid,uuid,date,numeric,jsonb,jsonb,jsonb,text,numeric
) to authenticated;

commit;
