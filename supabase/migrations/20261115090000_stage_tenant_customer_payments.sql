-- M2 operational writer: tenant-scoped customer debt payments.
-- Staged behind a dedicated default-OFF gate. This does not activate any
-- business, change the legacy write-scope gate, or grant direct table DML.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.business_customer_payment_gate (
  singleton boolean primary key default true check (singleton is true),
  enabled boolean not null default false
);
insert into private.business_customer_payment_gate(singleton,enabled)
values (true,false);
alter table private.business_customer_payment_gate enable row level security;
revoke all on private.business_customer_payment_gate
from public,anon,authenticated,service_role;

-- New business payment history is visible only through the same verified
-- owner/business predicate used by other staged customer setup data.
alter policy owner_read on public.customer_payments
using (
  private.can_read_legacy_customer(business_id)
  or private.can_manage_new_customer(business_id)
);

-- Preserve the original singleton receipt snapshot. For a nonlegacy business,
-- freeze its own profile and customer identity instead of the legacy shop's.
create or replace function private.capture_receipt_business()
returns trigger
language plpgsql
security definer
set search_path=''
as $capture$
declare
  v_customer_name text;
begin
  if new.business_id is not null and exists (
    select 1 from private.businesses b
    where b.id=new.business_id and b.legacy_singleton is null
  ) then
    new.receipt_business := (
      select jsonb_build_object(
        'name',p.name,
        'address',p.address,
        'phone',p.phone,
        'logo_url',null
      )
      from public.business_profiles p
      where p.business_id=new.business_id
    );
    if new.receipt_business is null then
      raise exception using
        errcode='23503',
        message='Business receipt details are unavailable.';
    end if;

    select c.name
    into v_customer_name
    from public.customers c
    where c.id=new.customer_id
      and c.business_id=new.business_id;
  else
    new.receipt_business := (
      select jsonb_build_object(
        'name',name,
        'address',address,
        'phone',phone,
        'logo_url',logo_url
      )
      from public.shop_profile
      where id
    );

    select c.name
    into v_customer_name
    from public.customers c
    where c.id=new.customer_id;
  end if;

  if v_customer_name is null then
    raise exception using
      errcode='23503',
      message='Customer no longer exists.';
  end if;

  new.receipt_customer_name := v_customer_name;
  new.receipt_customer_name_source := 'captured';
  return new;
end;
$capture$;

-- Extend the existing write guard only for the two rows touched by a
-- customer payment: the balance UPDATE and immutable payment INSERT.
-- Direct client DML remains revoked; the RPC independently checks every row.
do $scope_business_customer_payment_writes$
declare
  v_oid oid:='private.scope_legacy_operational_write()'::regprocedure;
  v_src text;
  v_anchor constant text:=
    E'  if tg_table_name in (\n      ''customer_opening_balances'',''money_owed'',''deposits'',\n';
  v_branch constant text:=$branch$
  if tg_table_schema='public'
     and (
       (tg_table_name='money_owed' and tg_op='UPDATE')
       or (tg_table_name='customer_payments' and tg_op='INSERT')
     )
     and new.business_id is not null
     and new.business_id is distinct from v_business then
    if not exists (
      select 1 from private.business_customer_payment_gate
      where enabled is true
    ) then
      raise exception 'Business customer payments are not available'
        using errcode='42501';
    end if;
    if tg_table_name='money_owed'
       and (old.business_id is distinct from new.business_id
         or old.customer_id is distinct from new.customer_id) then
      raise exception 'Customer balance identity cannot be changed'
        using errcode='42501';
    end if;
    v_actor:=auth.uid();
    if v_actor is null then
      raise exception 'Verified business owner session required'
        using errcode='42501';
    end if;
    perform 1 from private.business_memberships m
      join private.businesses b on b.id=m.business_id
      where m.business_id=new.business_id and m.user_id=v_actor
        and m.member_kind='owner' and m.status='active'
        and b.status='active' and b.legacy_singleton is null
      for share of m,b;
    if not found then
      raise exception 'Business payment is not available to this owner'
        using errcode='42501';
    end if;
    if not exists (
      select 1 from public.customers c
      where c.id=new.customer_id and c.business_id=new.business_id
    ) then
      raise exception 'Customer is not available in this business'
        using errcode='42501';
    end if;
    return new;
  end if;

$branch$;
begin
  v_src:=pg_catalog.pg_get_functiondef(v_oid);
  if v_src is null
     or (pg_catalog.length(v_src)
       -pg_catalog.length(pg_catalog.replace(v_src,v_anchor,'')))
       /pg_catalog.length(v_anchor)<>1
     or pg_catalog.strpos(v_src,'private.business_customer_payment_gate')<>0 then
    raise exception 'Customer payment write-guard source drift';
  end if;
  execute pg_catalog.replace(v_src,v_anchor,v_branch||v_anchor);
end;
$scope_business_customer_payment_writes$;

create function public.record_business_customer_payment(
  p_business_id uuid,
  p_request_id uuid,
  p_customer_id uuid,
  p_amount numeric,
  p_business_date date,
  p_method text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $payment$
declare
  v_actor uuid:=auth.uid();
  v_customer public.customers%rowtype;
  v_payment public.customer_payments%rowtype;
  v_owed integer;
begin
  -- Authorization and feature gates precede replay, so a revoked owner
  -- cannot use an old request UUID to recover another depot's receipt.
  if v_actor is null or p_business_id is null then
    raise exception 'Verified business owner session required'
      using errcode='42501';
  end if;

  perform 1
  from private.business_memberships m
  join private.businesses b on b.id=m.business_id
  where m.business_id=p_business_id and m.user_id=v_actor
    and m.member_kind='owner' and m.status='active'
    and b.legacy_singleton is null and b.status='active'
  for share of m,b;
  if not found then
    raise exception 'Business payment is not available'
      using errcode='42501';
  end if;

  perform 1 from private.legacy_write_scope_gate
  where enabled is true
  for share;
  if not found then
    raise exception 'Business operational access is not available'
      using errcode='42501';
  end if;

  perform 1 from private.business_customer_payment_gate
  where enabled is true
  for share;
  if not found then
    raise exception 'Business customer payments are not available'
      using errcode='42501';
  end if;

  if p_request_id is null or p_customer_id is null
     or p_amount is null or p_amount='NaN'::numeric
     or p_amount<=0 or p_amount<>trunc(p_amount)
     or p_amount>2147483647
     or p_business_date is null
     or p_business_date>(pg_catalog.now() at time zone 'Africa/Lagos')::date
     or p_method not in ('cash','transfer','pos') or p_method is null then
    raise exception 'Check the payment amount, date and method'
      using errcode='22023';
  end if;

  -- The same UUID may legitimately be used by two different businesses.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_business_id::text||':'||p_request_id::text,0
    )
  );

  select * into v_payment
  from public.customer_payments
  where business_id=p_business_id and request_id=p_request_id
  for update;
  if found then
    if v_payment.customer_id is distinct from p_customer_id
       or v_payment.amount is distinct from p_amount::integer
       or v_payment.business_date is distinct from p_business_date
       or v_payment.method is distinct from p_method then
      raise exception 'This payment request was already used with different details'
        using errcode='22023';
    end if;
    return pg_catalog.jsonb_build_object(
      'paymentId',v_payment.id,
      'businessId',p_business_id,
      'customerId',p_customer_id,
      'requestId',p_request_id,
      'amount',v_payment.amount,
      'owing',v_payment.owed_after,
      'receiptNumber',v_payment.receipt_number,
      'verificationToken',v_payment.verification_token,
      'savedReplay',true
    );
  end if;

  select * into v_customer
  from public.customers
  where id=p_customer_id and business_id=p_business_id
    and archived_at is null
  for update;
  if not found then
    raise exception 'Customer is not available in this business'
      using errcode='22023';
  end if;

  select amount into v_owed
  from public.money_owed
  where customer_id=p_customer_id and business_id=p_business_id
  for update;
  if not found or v_owed<=0 then
    raise exception 'This customer does not owe any money'
      using errcode='22023';
  end if;
  if p_amount::integer>v_owed then
    raise exception 'Payment cannot exceed money owed'
      using errcode='22023';
  end if;

  update public.money_owed
  set amount=amount-p_amount::integer
  where customer_id=p_customer_id and business_id=p_business_id
  returning amount into v_owed;
  if not found then
    raise exception 'Customer balance is not available'
      using errcode='42501';
  end if;

  insert into public.customer_payments(
    business_id,customer_id,amount,owed_after,business_date,request_id,method
  ) values (
    p_business_id,p_customer_id,p_amount::integer,v_owed,
    p_business_date,p_request_id,p_method
  )
  returning * into v_payment;

  return pg_catalog.jsonb_build_object(
    'paymentId',v_payment.id,
    'businessId',p_business_id,
    'customerId',p_customer_id,
    'requestId',p_request_id,
    'amount',v_payment.amount,
    'owing',v_payment.owed_after,
    'receiptNumber',v_payment.receipt_number,
    'verificationToken',v_payment.verification_token,
    'savedReplay',false
  );
end;
$payment$;

revoke all on function public.record_business_customer_payment(
  uuid,uuid,uuid,numeric,date,text
) from public,anon,authenticated,service_role;
grant execute on function public.record_business_customer_payment(
  uuid,uuid,uuid,numeric,date,text
) to authenticated;

commit;
