begin;

-- Immutable payment ledger. A payment reduces the customer's total money owed;
-- it is never allocated to a specific sale and never edits sale totals/paid_amount.
create table public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  amount integer not null check (amount > 0),
  owed_after integer not null check (owed_after >= 0),
  business_date date not null check (business_date between date '0001-01-01' and date '9999-12-31'),
  created_at timestamptz not null default now(),
  request_id uuid not null unique
);
create index customer_payments_customer_id_idx on public.customer_payments(customer_id);
create index customer_payments_recent_idx on public.customer_payments(created_at desc, id desc);
alter table public.customer_payments enable row level security;
revoke all on public.customer_payments from public, anon, authenticated;
grant select on public.customer_payments to authenticated;
create policy owner_read on public.customer_payments for select to authenticated
using (exists(select 1 from private.shop_owner where user_id = (select auth.uid())));

create function private.record_payment(p_request_id uuid,p_customer_id uuid,p_amount numeric,p_business_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_payment public.customer_payments%rowtype;
  v_customer public.customers%rowtype;
  v_owed integer;
begin
  if auth.uid() is null or not exists(select 1 from private.shop_owner where user_id=auth.uid()) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_request_id is null or p_customer_id is null or p_amount is null
    or p_amount='NaN'::numeric or p_amount<=0 or p_amount<>trunc(p_amount) or p_amount>2147483647 then
    raise exception using errcode='22023',message='Enter a whole payment amount greater than zero.';
  end if;
  if p_business_date is null or p_business_date not between date '0001-01-01' and date '9999-12-31' then
    raise exception using errcode='22023',message='Choose a valid business date.';
  end if;

  -- Retry-safe: replaying the same form returns the original result unchanged.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  select * into v_payment from public.customer_payments where request_id=p_request_id;
  if found then
    if v_payment.customer_id is distinct from p_customer_id
      or v_payment.amount is distinct from p_amount::integer
      or v_payment.business_date is distinct from p_business_date then
      raise exception using errcode='22023',message='This payment form was already used with different details.';
    end if;
    return jsonb_build_object('id',v_payment.id,'amount',v_payment.amount,'owing',v_payment.owed_after,'customer',p_customer_id);
  end if;

  select * into v_customer from public.customers where id=p_customer_id for key share;
  if not found then raise exception using errcode='22023',message='Customer no longer exists.'; end if;

  -- Lock the balance row so two payments (or a payment and a sale) for the
  -- same customer cannot race each other; overpayment and zero-debt are
  -- rejected here, against the current locked balance, not a stale snapshot.
  select amount into v_owed from public.money_owed where customer_id=p_customer_id for update;
  if not found or v_owed=0 then
    raise exception using errcode='22023',message='This customer does not owe any money.';
  end if;
  if p_amount::integer>v_owed then
    raise exception using errcode='22023',message='Payment cannot exceed money owed.';
  end if;

  update public.money_owed set amount=amount-p_amount::integer
    where customer_id=p_customer_id returning amount into v_owed;
  insert into public.customer_payments(customer_id,amount,owed_after,business_date,request_id)
    values(p_customer_id,p_amount::integer,v_owed,p_business_date,p_request_id)
    returning * into v_payment;
  return jsonb_build_object('id',v_payment.id,'amount',v_payment.amount,'owing',v_payment.owed_after,'customer',p_customer_id);
end $$;
revoke all on function private.record_payment(uuid,uuid,numeric,date) from public,anon,authenticated;
create function public.record_payment(p_request_id uuid,p_customer_id uuid,p_amount numeric,p_business_date date)
returns jsonb language sql security definer set search_path='' as $$
 select private.record_payment(p_request_id,p_customer_id,p_amount,p_business_date);
$$;
revoke all on function public.record_payment(uuid,uuid,numeric,date) from public,anon;
grant execute on function public.record_payment(uuid,uuid,numeric,date) to authenticated;
commit;
