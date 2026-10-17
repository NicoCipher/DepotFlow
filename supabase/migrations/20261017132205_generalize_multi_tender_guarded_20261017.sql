begin;

-- Expand (do not rewrite) the deployed immutable Cash + Transfer ledger.
-- The existing split saver remains unchanged and operational.
alter table public.sale_tender_legs
  drop constraint sale_tender_legs_method_check;
alter table public.sale_tender_legs
  add constraint sale_tender_legs_method_check
  check (method in ('cash','transfer','pos'));

-- The existing deferred trigger now supports exactly two or three real
-- methods, and checks older-debt receipts against their actual contributors.
create or replace function private.assert_sale_tender_complete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_sale_id uuid;
  v_sale record;
  v_count integer;
  v_paid_sale bigint;
  v_paid_old bigint;
  v_old_method_count integer;
  v_old_single_method text;
  v_expected_old integer;
  v_payment_id uuid;
  v_payment public.customer_payments%rowtype;
  v_expected_payment_method text;
begin
  if tg_table_name = 'sales' then
    v_sale_id := new.id;
  else
    v_sale_id := new.sale_id;
  end if;
  select id,request_id,customer_id,paid_amount,payment_method,account_receipt
    into v_sale from public.sales where id=v_sale_id;
  if not found then
    raise exception using errcode='22023', message='Unknown tender sale.';
  end if;
  select count(*),coalesce(sum(sale_amount),0),coalesce(sum(old_debt_amount),0),
    count(*) filter (where old_debt_amount > 0),
    min(method) filter (where old_debt_amount > 0)
  into v_count,v_paid_sale,v_paid_old,v_old_method_count,v_old_single_method
  from public.sale_tender_legs where sale_id=v_sale_id;

  if v_sale.payment_method <> 'mixed' then
    if v_count > 0 then
      raise exception using errcode='22023', message='Tender legs require a mixed sale.';
    end if;
    return null;
  end if;

  if v_sale.account_receipt is null then
    raise exception using errcode='22023', message='Mixed sale needs a frozen account receipt.';
  end if;
  v_expected_old := coalesce((v_sale.account_receipt->>'paidOld')::integer, 0);
  if v_count not between 2 and 3 or v_paid_sale <> v_sale.paid_amount or
    v_paid_old <> v_expected_old or v_paid_sale + v_paid_old > 2147483647 then
    raise exception using errcode='22023', message='Split tender does not match the saved sale and previous debt.';
  end if;
  if v_expected_old = 0 then
    if exists (select 1 from public.sale_tender_legs
               where sale_id=v_sale_id and old_debt_payment_id is not null) then
      raise exception using errcode='22023', message='Unexpected old-debt tender link.';
    end if;
    return null;
  end if;

  -- The existing old-debt receipt has a deterministic request ID.
  v_payment_id := md5('depotflow:old-debt:' || v_sale.request_id::text)::uuid;
  select * into v_payment from public.customer_payments
    where request_id=v_payment_id;
  if not found or v_payment.customer_id <> v_sale.customer_id or
    v_payment.amount <> v_expected_old then
    raise exception using errcode='22023', message='Split tender old-debt receipt mismatch.';
  end if;
  if exists (select 1 from public.sale_tender_legs l
             where l.sale_id=v_sale_id and l.old_debt_amount>0
             and l.old_debt_payment_id <> v_payment.id) then
    raise exception using errcode='22023', message='Split tender links to the wrong debt payment.';
  end if;
  v_expected_payment_method := case
    when v_old_method_count > 1 then 'mixed'
    else v_old_single_method
  end;
  if v_payment.method <> v_expected_payment_method then
    raise exception using errcode='22023', message='Old-debt receipt tender methods do not match.';
  end if;
  return null;
end;
$$;


-- New saver does not replace save_sale_split_tender. Old request IDs, hashes
-- and late-write fences are unchanged. No access until a separate release grant.
create function public.save_sale_multi_tender(
  p_request_id uuid, p_customer_id uuid, p_business_date date,
  p_paid numeric, p_lines jsonb, p_returned_crates jsonb,
  p_returned_bottles jsonb, p_old_debt_paid numeric, p_tenders jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_fingerprint text;
  v_saved public.sales%rowtype;
  v_result jsonb;
  v_leg jsonb;
  v_method text;
  v_sale_part numeric;
  v_old_part numeric;
  v_amount numeric;
  v_sale_sum numeric := 0;
  v_old_sum numeric := 0;
  v_payment_id uuid;
  v_old_receipt_method text;
  v_old_methods integer := 0;
  v_single_old_method text;
  v_seen_methods text[] := array[]::text[];
  v_last_order integer := 0;
  v_order integer;
  v_index integer;
  v_original_account jsonb;
begin
  if (select auth.uid()) is null
    or not exists (select 1 from private.shop_owner
                   where user_id=(select auth.uid())) then
    raise exception using errcode='42501',message='Owner only';
  end if;

  -- A previous split saver in the same transaction may have made checks
  -- immediate. Restore deferral before writing mixed sale and tender legs.
  set constraints public.sale_tender_complete_on_leg, public.sale_tender_complete_on_mixed_sale deferred;

  if p_request_id is null or p_customer_id is null
    or p_business_date is null or p_lines is null or
    p_returned_crates is null or p_returned_bottles is null or
    p_paid is null or p_old_debt_paid is null or
    p_paid = 'NaN'::numeric or p_old_debt_paid = 'NaN'::numeric or
    p_paid < 0 or p_old_debt_paid < 0 or
    p_paid <> trunc(p_paid) or p_old_debt_paid <> trunc(p_old_debt_paid) or
    p_paid + p_old_debt_paid > 2147483647 or
    jsonb_typeof(p_tenders) is distinct from 'array' or
    jsonb_array_length(p_tenders) not between 2 and 3 then
    raise exception using errcode='22023',
      message='Check the recorded payment methods and amounts.';
  end if;

  for v_index in 0..jsonb_array_length(p_tenders)-1 loop
    v_leg := p_tenders->v_index;
    if jsonb_typeof(v_leg) is distinct from 'object' or
      jsonb_typeof(v_leg->'saleAmount') is distinct from 'number' or
      jsonb_typeof(v_leg->'oldDebtAmount') is distinct from 'number' or
      jsonb_typeof(v_leg->'amount') is distinct from 'number' then
      raise exception using errcode='22023', message='Enter valid whole-naira amounts.';
    end if;
    v_method := v_leg->>'method';
    v_order := case v_method when 'cash' then 1 when 'transfer' then 2
      when 'pos' then 3 else 0 end;
    if v_order = 0 or v_order <= v_last_order or v_method = any(v_seen_methods) then
      raise exception using errcode='22023',
        message='Use two or three different payment methods in a consistent order.';
    end if;
    v_last_order := v_order;
    v_seen_methods := array_append(v_seen_methods, v_method);
    v_sale_part := (v_leg->>'saleAmount')::numeric;
    v_old_part := (v_leg->>'oldDebtAmount')::numeric;
    v_amount := (v_leg->>'amount')::numeric;
    if v_sale_part = 'NaN'::numeric or v_old_part = 'NaN'::numeric or
      v_amount = 'NaN'::numeric or
      v_sale_part < 0 or v_old_part < 0 or v_amount <= 0 or
      v_sale_part <> trunc(v_sale_part) or
      v_old_part <> trunc(v_old_part) or v_amount <> trunc(v_amount) or
      v_amount > 2147483647 or v_amount <> v_sale_part + v_old_part then
      raise exception using errcode='22023',
        message='A payment method has invalid sale or debt allocations.';
    end if;
    v_sale_sum := v_sale_sum + v_sale_part;
    v_old_sum := v_old_sum + v_old_part;
    if v_old_part > 0 then
      v_old_methods := v_old_methods + 1;
      v_single_old_method := v_method;
    end if;
  end loop;

  if v_sale_sum <> p_paid or v_old_sum <> p_old_debt_paid then
    raise exception using errcode='22023',
      message='Payment methods must match the sale and old-debt payments.';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'customer',p_customer_id,'day',p_business_date,
    'paid',p_paid,'oldPaid',p_old_debt_paid,
    'lines',p_lines,'crates',p_returned_crates,'bottles',p_returned_bottles,
    'legs',p_tenders
  )::text);

  -- Same advisory key and lock order as the existing atomic checkout.
  -- Never run a second save to investigate whether a request already committed.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text,0));

  select * into v_saved from public.sales
    where request_id=p_request_id for update;
  if found then
    if v_saved.split_request_hash is distinct from v_fingerprint or
       v_saved.customer_id <> p_customer_id or
       v_saved.payment_method <> 'mixed' then
      raise exception using errcode='22023',
        message='This sale request was already used with different details.';
    end if;
    -- Read the actual immutable stored legs, not request-supplied values.
    if (select count(*) from public.sale_tender_legs
        where sale_id=v_saved.id) <> jsonb_array_length(p_tenders) or
       exists (select 1 from public.sale_tender_legs l
          where l.sale_id=v_saved.id and not exists (
            select 1 from jsonb_array_elements(p_tenders) j
            where j->>'method'=l.method and
              (j->>'saleAmount')::integer=l.sale_amount and
              (j->>'oldDebtAmount')::integer=l.old_debt_amount
          )) then
      raise exception using errcode='22023',
        message='Stored payment details do not match this request.';
    end if;
    v_original_account := v_saved.account_receipt;
    return jsonb_build_object(
      'id',v_saved.id,'total',v_saved.total_amount,'paid',v_saved.paid_amount,
      'owing',v_saved.total_amount-v_saved.paid_amount,
      'oldDebtPaid',coalesce((v_original_account->>'paidOld')::integer,0),
      'oldDebtPaymentId',(select p.id from public.customer_payments p
        where p.request_id=md5('depotflow:old-debt:' || p_request_id::text)::uuid),
      'oldDebtReceiptRequestId',
         case when coalesce((v_original_account->>'paidOld')::integer,0)>0
           then md5('depotflow:old-debt:' || p_request_id::text)::uuid
           else null end,
      'balanceAfter',(v_original_account->>'cd')::integer,
      'tenders',p_tenders
    );
  end if;

  -- Reuse the proven customer/stock/empties/debt saver INSIDE this RPC's
  -- transaction. Its required legacy method is provisional, not published:
  -- both ledger methods are committed before any response is observable.
  v_result := public.save_sale_with_old_debt_payment(
    p_request_id,p_customer_id,p_business_date,p_paid,
    p_lines,p_returned_crates,p_returned_bottles,
    'cash',p_old_debt_paid
  );

  if p_old_debt_paid > 0 then
    v_payment_id := md5('depotflow:old-debt:' || p_request_id::text)::uuid;
    v_old_receipt_method := case
      when v_old_methods > 1 then 'mixed'
      else v_single_old_method end;
    update public.customer_payments
      set method=v_old_receipt_method
      where request_id=v_payment_id and customer_id=p_customer_id;
    if not found then
      raise exception using errcode='22023',
        message='Missing previous-debt receipt for split payment.';
    end if;
  end if;

  update public.sales set
    payment_method='mixed',split_request_hash=v_fingerprint
    where id=(v_result->>'id')::uuid
      and request_id=p_request_id and customer_id=p_customer_id;
  if not found then
    raise exception using errcode='22023',
      message='Saved sale cannot be matched to split payment.';
  end if;

  for v_leg in select value from jsonb_array_elements(p_tenders) loop
    v_old_part := (v_leg->>'oldDebtAmount')::integer;
    insert into public.sale_tender_legs(
      sale_id,method,sale_amount,old_debt_amount,old_debt_payment_id
    ) values (
      (v_result->>'id')::uuid,v_leg->>'method',
      (v_leg->>'saleAmount')::integer,v_old_part::integer,
      case when v_old_part>0
        then (select id from public.customer_payments
          where request_id=v_payment_id and customer_id=p_customer_id)
        else null end
    );
  end loop;
  -- Execute the deferred checks while still inside the same transaction.
  set constraints public.sale_tender_complete_on_leg, public.sale_tender_complete_on_mixed_sale immediate;
  -- The forced check has run; leave transaction-wide trigger mode as found
  -- for callers that run more than one checkout in the same transaction.
  set constraints public.sale_tender_complete_on_leg, public.sale_tender_complete_on_mixed_sale deferred;

  return v_result || jsonb_build_object('tenders',p_tenders);
end;
$$;


revoke all on function public.save_sale_multi_tender(
 uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb
) from public,anon,authenticated;

commit;
