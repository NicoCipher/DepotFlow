-- Keep the public verification page useful without exposing private ledger data.
-- The opaque verification token is already printed/shared on the receipt, so
-- return only the same customer-facing facts that appear on that receipt.
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
    'customer', c.name,
    'status', p.receipt_status,
    'kind', 'payment',
    'method', p.method,
    'total', null,
    'balance', p.owed_after,
    'business', coalesce(
      p.receipt_business,
      (
        select jsonb_build_object(
          'name', sp.name,
          'address', sp.address,
          'phone', sp.phone,
          'logo_url', sp.logo_url
        )
        from public.shop_profile sp
        where sp.id=true
      ),
      '{}'::jsonb
    ),
    'items', '[]'::jsonb
  )
  into v_result
  from public.customer_payments p
  join public.customers c on c.id=p.customer_id
  where p.verification_token=p_token;

  if found then
    return v_result;
  end if;

  select jsonb_build_object(
    'number', s.receipt_number,
    'amount', s.paid_amount,
    'date', s.business_date,
    'customer', c.name,
    'status', s.receipt_status,
    'kind', 'sale',
    'method', s.payment_method,
    'total', s.total_amount,
    'balance', s.total_amount-s.paid_amount,
    'business', coalesce(
      s.receipt_business,
      (
        select jsonb_build_object(
          'name', sp.name,
          'address', sp.address,
          'phone', sp.phone,
          'logo_url', sp.logo_url
        )
        from public.shop_profile sp
        where sp.id=true
      ),
      '{}'::jsonb
    ),
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
  join public.customers c on c.id=s.customer_id
  where s.verification_token=p_token
    and s.paid_amount>0;

  return v_result;
end;
$$;

revoke all on function public.verify_receipt(uuid) from public;
grant execute on function public.verify_receipt(uuid) to anon, authenticated;
