begin;

-- Receipt identifiers are assigned by the database only after the ledger row saves.
create sequence public.receipt_number_seq;
revoke all on sequence public.receipt_number_seq from public, anon, authenticated;
alter table public.customer_payments
  add column method text not null default 'not_recorded' check (method in ('cash','transfer','pos','not_recorded')),
  add column receipt_number text not null default ('DF-' || lpad(nextval('public.receipt_number_seq')::text, 9, '0')) unique,
  add column verification_token uuid not null default gen_random_uuid() unique,
  add column receipt_status text not null default 'valid' check (receipt_status in ('valid','voided'));
alter table public.sales
  add column payment_method text not null default 'not_recorded' check (payment_method in ('cash','transfer','pos','not_recorded')),
  add column receipt_number text not null default ('DF-' || lpad(nextval('public.receipt_number_seq')::text, 9, '0')) unique,
  add column verification_token uuid not null default gen_random_uuid() unique,
  add column receipt_status text not null default 'valid' check (receipt_status in ('valid','voided'));
create index customer_payments_verification_idx on public.customer_payments(verification_token);
create index sales_verification_idx on public.sales(verification_token);

-- Existing payment saver already locks the balance and enforces idempotency.
-- The wrapper records the method in the same transaction and checks replay details.
create function public.record_payment(p_request_id uuid,p_customer_id uuid,p_amount numeric,p_business_date date,p_method text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_method text;
begin
  if p_method not in ('cash','transfer','pos') or p_method is null then
    raise exception using errcode='22023',message='Choose a payment method.';
  end if;
  v_result := private.record_payment(p_request_id,p_customer_id,p_amount,p_business_date);
  select method into v_method from public.customer_payments where request_id=p_request_id for update;
  if v_method not in ('not_recorded',p_method) then
    raise exception using errcode='22023',message='This payment form was already used with different details.';
  end if;
  update public.customer_payments set method=p_method where request_id=p_request_id and method='not_recorded';
  return v_result;
end $$;
revoke all on function public.record_payment(uuid,uuid,numeric,date,text) from public,anon;
grant execute on function public.record_payment(uuid,uuid,numeric,date,text) to authenticated;
-- Keep the prior overload for in-flight forms during the release; new UI uses the method-aware overload.

create function public.save_sale_v2(
  p_request_id uuid,p_customer_id uuid,p_business_date date,p_paid numeric,
  p_lines jsonb,p_returned_crates jsonb,p_returned_bottles jsonb,p_payment_method text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_method text;
begin
  if p_paid > 0 and (p_payment_method is null or p_payment_method not in ('cash','transfer','pos')) then
    raise exception using errcode='22023',message='Choose how the customer paid.';
  end if;
  v_result := private.save_sale_v2(p_request_id,p_customer_id,p_business_date,p_paid,p_lines,p_returned_crates,p_returned_bottles);
  if p_paid > 0 then
    select payment_method into v_method from public.sales where request_id=p_request_id for update;
    if v_method not in ('not_recorded',p_payment_method) then
      raise exception using errcode='22023',message='This sale form was already used with different payment details.';
    end if;
    update public.sales set payment_method=p_payment_method where request_id=p_request_id and payment_method='not_recorded';
  end if;
  return v_result;
end $$;
revoke all on function public.save_sale_v2(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,text) from public,anon;
grant execute on function public.save_sale_v2(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,text) to authenticated;
-- Keep the prior overload for in-flight sale forms during the release.

-- Opaque token lookup only. This function never returns names, phone numbers,
-- balances, request IDs, or the private ledger. No rows means invalid token.
create function public.verify_receipt(p_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  select jsonb_build_object('number',p.receipt_number,'amount',p.amount,
    'date',p.business_date,'customer',left(c.name,1) || '••• · ' || right(c.id::text,6),
    'status',p.receipt_status,'kind','payment') into v_result
  from public.customer_payments p join public.customers c on c.id=p.customer_id
  where p.verification_token=p_token;
  if found then return v_result; end if;
  select jsonb_build_object('number',s.receipt_number,'amount',s.paid_amount,
    'date',s.business_date,'customer',left(c.name,1) || '••• · ' || right(c.id::text,6),
    'status',s.receipt_status,'kind','sale payment') into v_result
  from public.sales s join public.customers c on c.id=s.customer_id
  where s.verification_token=p_token and s.paid_amount>0;
  return v_result;
end $$;
revoke all on function public.verify_receipt(uuid) from public;
grant execute on function public.verify_receipt(uuid) to anon,authenticated;
-- Aggregates stay in the database so totals include the full selected period.
create function public.manager_snapshot(p_day date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from private.shop_owner where user_id=auth.uid()) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  select jsonb_build_object(
    'sales_count',(select count(*) from public.sales where business_date=p_day),
    'sales_value',(select coalesce(sum(total_amount),0) from public.sales where business_date=p_day),
    'received',(select coalesce(sum(paid_amount),0) from public.sales where business_date=p_day) +
      (select coalesce(sum(amount),0) from public.customer_payments where business_date=p_day),
    'outstanding',(select coalesce(sum(amount),0) from public.money_owed),
    'customers_owing',(select count(*) from public.money_owed where amount>0),
    'low_stock',(select count(*) from public.products p left join public.stock st on st.product_id=p.id
      where st.total_bottles is null or st.total_bottles<=p.bottles_per_crate),
    'missing_counts',(select count(*) from public.products p left join public.stock st on st.product_id=p.id where st.total_bottles is null)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.manager_snapshot(date) from public,anon;
grant execute on function public.manager_snapshot(date) to authenticated;

create function public.store_activity(p_from date,p_to date,p_customer uuid,p_type text,p_limit integer,p_offset integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from private.shop_owner where user_id=auth.uid()) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_from is null or p_to is null or p_from>p_to or p_limit not between 1 and 100 or p_offset<0
    or p_type not in ('all','sale','payment','stock','empties') then
    raise exception using errcode='22023',message='Invalid activity filters.';
  end if;
  with events as (
    select s.id,s.business_date as day,s.created_at,'sale'::text as kind,c.name as title,
      s.customer_id,s.total_amount::bigint as sale_value,s.paid_amount::bigint as received,
      'Sale · ' || c.name as description, '/sales/' || s.id as detail
    from public.sales s join public.customers c on c.id=s.customer_id where s.business_date between p_from and p_to
    union all
    select p.id,p.business_date,p.created_at,'payment',c.name,p.customer_id,0::bigint,p.amount::bigint,
      'Payment · ' || c.name,'/receipts/payment/' || p.request_id
    from public.customer_payments p join public.customers c on c.id=p.customer_id where p.business_date between p_from and p_to
    union all
    select m.id,m.business_date,m.created_at,'stock',m.product_name,null::uuid,0::bigint,0::bigint,
      case when m.movement_type='receive' then 'Received stock · ' else 'Stock count · ' end || m.product_name,
      '/activity/stock/' || m.id
    from public.stock_movements m where m.business_date between p_from and p_to
    union all
    select m.id,m.business_date,m.created_at,'empties',m.crate_type,null::uuid,0::bigint,0::bigint,
      'Empty crate count · ' || m.crate_type,'/activity/empties/' || m.id
    from public.empty_crate_movements m where m.business_date between p_from and p_to
    union all
    select s.id,s.business_date,s.created_at,'empties',c.name,s.customer_id,0::bigint,0::bigint,
      'Empties returned · ' || c.name,'/sales/' || s.id
    from public.sales s join public.customers c on c.id=s.customer_id
    where s.business_date between p_from and p_to and (
      exists(select 1 from public.sale_empty_crate_returns r where r.sale_id=s.id)
      or exists(select 1 from public.sale_empty_bottle_returns r where r.sale_id=s.id))
  ), filtered as (
    select * from events where (p_customer is null or customer_id=p_customer)
      and (p_type='all' or kind=p_type)
  )
  select jsonb_build_object(
    'count',(select count(*) from filtered),
    'sales_value',(select coalesce(sum(sale_value),0) from filtered),
    'received',(select coalesce(sum(received),0) from filtered),
    'items',(select coalesce(jsonb_agg(to_jsonb(page)), '[]'::jsonb) from (
      select id,day,created_at,kind,title,description,detail,sale_value,received
      from filtered order by day desc,created_at desc,kind,id desc limit p_limit offset p_offset
    ) page)
  ) into v_result;
  return v_result;
end $$;
revoke all on function public.store_activity(date,date,uuid,text,integer,integer) from public,anon;
grant execute on function public.store_activity(date,date,uuid,text,integer,integer) to authenticated;
commit;
