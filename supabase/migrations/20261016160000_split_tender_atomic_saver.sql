begin;

-- Additive, intentionally inactive. This new entry point is not called from
-- checkout until the receipt/public-verification migration is deployed.
-- Fingerprint ensures replay cannot reinterpret product, empty-return or tender
-- decisions under a previously committed request identifier.
alter table public.sales
  add column split_request_hash text
    check (split_request_hash is null or split_request_hash ~ '^[0-9a-f]{32}$');

create function public.save_sale_split_tender(
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
  v_cash_old numeric := 0;
  v_transfer_old numeric := 0;
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
  set constraints sale_tender_complete_on_leg, sale_tender_complete_on_mixed_sale deferred;

  if p_request_id is null or p_customer_id is null
    or p_business_date is null or p_lines is null or
    p_returned_crates is null or p_returned_bottles is null or
    p_paid is null or p_old_debt_paid is null or
    p_paid = 'NaN'::numeric or p_old_debt_paid = 'NaN'::numeric or
    p_paid < 0 or p_old_debt_paid < 0 or
    p_paid <> trunc(p_paid) or p_old_debt_paid <> trunc(p_old_debt_paid) or
    p_paid + p_old_debt_paid > 2147483647 or
    jsonb_typeof(p_tenders) is distinct from 'array' or
    jsonb_array_length(p_tenders) <> 2 then
    raise exception using errcode='22023',
      message='Check the Cash and Transfer amounts.';
  end if;

  for v_index in 0..1 loop
    v_leg := p_tenders->v_index;
    if jsonb_typeof(v_leg) is distinct from 'object' or
      (v_index = 0 and v_leg->>'method' is distinct from 'cash') or
      (v_index = 1 and v_leg->>'method' is distinct from 'transfer') or
      jsonb_typeof(v_leg->'saleAmount') is distinct from 'number' or
      jsonb_typeof(v_leg->'oldDebtAmount') is distinct from 'number' or
      jsonb_typeof(v_leg->'amount') is distinct from 'number' then
      raise exception using errcode='22023',
        message='Use exactly Cash and Transfer with whole naira amounts.';
    end if;
    v_method := v_leg->>'method';
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
    if v_method='cash' then v_cash_old := v_old_part;
    else v_transfer_old := v_old_part; end if;
  end loop;

  if v_sale_sum <> p_paid or v_old_sum <> p_old_debt_paid then
    raise exception using errcode='22023',
      message='Cash and Transfer must match the sale and old-debt payments.';
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
        where sale_id=v_saved.id) <> 2 or
       exists (select 1 from public.sale_tender_legs l
          where l.sale_id=v_saved.id and
          (l.sale_amount <> (p_tenders->(case when l.method='cash' then 0 else 1 end)->>'saleAmount')::integer
           or l.old_debt_amount <> (p_tenders->(case when l.method='cash' then 0 else 1 end)->>'oldDebtAmount')::integer)) then
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
      when v_cash_old > 0 and v_transfer_old > 0 then 'mixed'
      when v_cash_old > 0 then 'cash'
      else 'transfer' end;
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
  set constraints sale_tender_complete_on_leg, sale_tender_complete_on_mixed_sale immediate;

  return v_result || jsonb_build_object('tenders',p_tenders);
end;
$$;

revoke all on function public.save_sale_split_tender(
  uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb
) from public,anon;
grant execute on function public.save_sale_split_tender(
  uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb
) to authenticated;

commit;
