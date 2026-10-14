begin;

-- Return only the immutable account facts already printed on the customer
-- receipt, behind the existing unguessable verification token.
-- Legacy receipts have account=null and retain their original sale facts.
-- New unpaid sales are sale statements, not false payment confirmations.
create or replace function public.verify_receipt(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'number', p.receipt_number,
    'amount', p.amount,
    'date', p.business_date,
    'customer', p.receipt_customer_name,
    'customer_snapshot_source', p.receipt_customer_name_source,
    'status', p.receipt_status,
    'kind', 'payment',
    'method', p.method,
    'total', null,
    'balance', p.owed_after,
    'business_snapshot', p.receipt_business is not null,
    'business', case
      when p.receipt_business is null then '{}'::jsonb
      else jsonb_strip_nulls(jsonb_build_object(
        'name', p.receipt_business->>'name',
        'address', p.receipt_business->>'address',
        'phone', p.receipt_business->>'phone'
      ))
    end,
    'items', '[]'::jsonb
  )
  into v_result
  from public.customer_payments p
  where p.verification_token=p_token;

  if found then
    return v_result;
  end if;

  select jsonb_build_object(
    'number', s.receipt_number,
    'amount', s.paid_amount,
    'date', s.business_date,
    'customer', s.receipt_customer_name,
    'customer_snapshot_source', s.receipt_customer_name_source,
    'status', s.receipt_status,
    'kind', 'sale',
    'method', s.payment_method,
    'total', s.total_amount,
    'balance', s.total_amount-s.paid_amount,
    'account', s.account_receipt,
    'business_snapshot', s.receipt_business is not null,
    'business', case
      when s.receipt_business is null then '{}'::jsonb
      else jsonb_strip_nulls(jsonb_build_object(
        'name', s.receipt_business->>'name',
        'address', s.receipt_business->>'address',
        'phone', s.receipt_business->>'phone'
      ))
    end,
    'items', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'name', i.product_name,
            'total_bottles', i.total_bottles,
            'bottles_per_crate', i.bottles_per_crate,
            'whole_crates', i.whole_crates,
            'amount', i.line_total
          )
          order by i.id
        ),
        '[]'::jsonb
      )
      from public.sale_items i
      where i.sale_id=s.id
    )
  )
  into v_result
  from public.sales s
  where s.verification_token=p_token;

  return v_result;
end;
$$;

revoke all on function public.verify_receipt(uuid) from public;
grant execute on function public.verify_receipt(uuid) to anon, authenticated;

commit;
