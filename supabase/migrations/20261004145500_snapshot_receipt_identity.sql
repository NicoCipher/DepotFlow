-- Preserve receipt identity as historical data instead of reading mutable live records.
alter table public.sales
  add column receipt_customer_name text,
  add column receipt_customer_name_source text
    check (receipt_customer_name_source in ('captured','legacy_backfill'));

alter table public.customer_payments
  add column receipt_customer_name text,
  add column receipt_customer_name_source text
    check (receipt_customer_name_source in ('captured','legacy_backfill'));

-- Existing receipts predate customer-name snapshots. Freeze the best information
-- currently available and mark it honestly as a legacy backfill.
update public.sales s
set receipt_customer_name=c.name,
    receipt_customer_name_source='legacy_backfill'
from public.customers c
where c.id=s.customer_id;

update public.customer_payments p
set receipt_customer_name=c.name,
    receipt_customer_name_source='legacy_backfill'
from public.customers c
where c.id=p.customer_id;

alter table public.sales
  alter column receipt_customer_name set not null,
  alter column receipt_customer_name_source set not null;

alter table public.customer_payments
  alter column receipt_customer_name set not null,
  alter column receipt_customer_name_source set not null;

-- Existing receipt triggers already call this function. Extend it so every new
-- sale/payment snapshots both the shop identity and the customer-facing name.
create or replace function private.capture_receipt_business()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_customer_name text;
begin
  new.receipt_business := (
    select jsonb_build_object(
      'name', name,
      'address', address,
      'phone', phone,
      'logo_url', logo_url
    )
    from public.shop_profile
    where id
  );

  select c.name
  into v_customer_name
  from public.customers c
  where c.id=new.customer_id;

  if v_customer_name is null then
    raise exception using
      errcode='23503',
      message='Customer no longer exists.';
  end if;

  new.receipt_customer_name := v_customer_name;
  new.receipt_customer_name_source := 'captured';
  return new;
end;
$$;

revoke all on function private.capture_receipt_business() from public, anon, authenticated;

-- Public receipt verification may reveal only facts intentionally printed on
-- the receipt. Never substitute mutable customer/shop records for missing history.
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
  where s.verification_token=p_token
    and s.paid_amount>0;

  return v_result;
end;
$$;

revoke all on function public.verify_receipt(uuid) from public;
grant execute on function public.verify_receipt(uuid) to anon, authenticated;
