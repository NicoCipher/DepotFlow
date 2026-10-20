-- M2f-4: a legacy owner must not infer a foreign customer's balance,
-- payment replay, or held-empty release state through SECURITY DEFINER RPCs.
-- ALL original shop writes stay available; new shop payment/return APIs stay
-- closed until their OWN tenant-safe atomic savers are independently reviewed.
-- Deliberately release-candidate only. Do not apply to production.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- This private writer is called by BOTH record_payment overloads and existing
-- sale paths. A caller-supplied UUID is never an authorization decision.
-- Limit every privileged SELECT, UPDATE and idempotency replay to the verified
-- legacy business BEFORE comparing any amount or returning an existing row.
create or replace function private.record_payment(
  p_request_id uuid,p_customer_id uuid,p_amount numeric,p_business_date date
) returns jsonb
language plpgsql security definer set search_path=''
as $legacy_payment_scope$
declare
  v_payment public.customer_payments%rowtype;
  v_customer public.customers%rowtype;
  v_owed integer;
begin
  if not private.verified_legacy_owner_read() then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_request_id is null or p_customer_id is null or p_amount is null
    or p_amount='NaN'::numeric or p_amount<=0
    or p_amount<>trunc(p_amount) or p_amount>2147483647 then
    raise exception using errcode='22023',message='Enter a whole payment amount greater than zero.';
  end if;
  if p_business_date is null or p_business_date not between date '0001-01-01' and date '9999-12-31' then
    raise exception using errcode='22023',message='Choose a valid business date.';
  end if;

  -- Original request ID remains the permanent idempotency boundary.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text,0)
  );
  select * into v_payment from public.customer_payments
  where request_id=p_request_id
    and private.can_read_legacy_customer(business_id);
  if found then
    if v_payment.customer_id is distinct from p_customer_id
      or v_payment.amount is distinct from p_amount::integer
      or v_payment.business_date is distinct from p_business_date then
      raise exception using errcode='22023',
        message='This payment form was already used with different details.';
    end if;
    return pg_catalog.jsonb_build_object(
      'id',v_payment.id,'amount',v_payment.amount,
      'owing',v_payment.owed_after,'customer',p_customer_id
    );
  end if;

  -- A foreign and unknown customer are deliberately indistinguishable.
  -- The table is read as SECURITY DEFINER: its RLS alone is insufficient.
  select * into v_customer from public.customers
  where id=p_customer_id
    and private.can_read_legacy_customer(business_id)
  for key share;
  if not found then
    raise exception using errcode='22023',message='Customer no longer exists.';
  end if;

  -- Preserve the current row lock and no-overpayment guarantee. The tenant
  -- predicate is applied before observing the balance or error branch.
  select amount into v_owed from public.money_owed
  where customer_id=p_customer_id
    and private.can_read_legacy_customer(business_id)
  for update;
  if not found or v_owed=0 then
    raise exception using errcode='22023',
      message='This customer does not owe any money.';
  end if;
  if p_amount::integer>v_owed then
    raise exception using errcode='22023',
      message='Payment cannot exceed money owed.';
  end if;

  update public.money_owed set amount=amount-p_amount::integer
  where customer_id=p_customer_id
    and private.can_read_legacy_customer(business_id)
  returning amount into v_owed;
  if not found then
    -- Do not proceed if the balance row changed ownership while waiting.
    raise exception using errcode='42501',message='Owner only';
  end if;

  insert into public.customer_payments(
    customer_id,amount,owed_after,business_date,request_id
  ) values(
    p_customer_id,p_amount::integer,v_owed,p_business_date,p_request_id
  ) returning * into v_payment;
  return pg_catalog.jsonb_build_object(
    'id',v_payment.id,'amount',v_payment.amount,
    'owing',v_payment.owed_after,'customer',p_customer_id
  );
end
$legacy_payment_scope$;
revoke all on function private.record_payment(uuid,uuid,numeric,date)
  from public,anon,authenticated,service_role;

-- The modern method-aware public wrapper must not perform an unscoped
-- privileged replay lookup after the private writer returns.
create or replace function public.record_payment(
  p_request_id uuid,p_customer_id uuid,p_amount numeric,
  p_business_date date,p_method text
) returns jsonb language plpgsql security definer set search_path=''
as $legacy_method_scope$
declare
  v_result jsonb;
  v_method text;
begin
  if not private.verified_legacy_owner_read() then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_method not in ('cash','transfer','pos') or p_method is null then
    raise exception using errcode='22023',message='Choose a payment method.';
  end if;
  v_result := private.record_payment(
    p_request_id,p_customer_id,p_amount,p_business_date
  );
  select method into v_method from public.customer_payments
  where request_id=p_request_id
    and private.can_read_legacy_customer(business_id)
  for update;
  if v_method not in ('not_recorded',p_method) then
    raise exception using errcode='22023',
      message='This payment form was already used with different details.';
  end if;
  update public.customer_payments set method=p_method
  where request_id=p_request_id
    and method='not_recorded'
    and private.can_read_legacy_customer(business_id);
  return v_result;
end
$legacy_method_scope$;
revoke all on function public.record_payment(uuid,uuid,numeric,date,text)
  from public,anon;
grant execute on function public.record_payment(uuid,uuid,numeric,date,text)
  to authenticated;

-- Equal behaviour for foreign held rows and IDs that do not exist. An old
-- shop owner can release ONLY its own held decisions and still generate the
-- same audit event. No foreign decision reaches the row-write trigger.
create or replace function private.release_held_empties(p_id uuid)
returns void language plpgsql security definer set search_path=''
as $legacy_release_scope$
declare
  v_decision record;
begin
  if not private.verified_legacy_owner_read() then
    raise exception using errcode='42501',message='Owner only';
  end if;
  update public.sale_empty_decisions
    set released_at=pg_catalog.now()
  where id=p_id and decision='hold' and released_at is null
    and private.can_read_legacy_customer(business_id)
  returning id,customer_id,released_at into v_decision;
  if found then
    insert into private.held_empty_collections(
      decision_id,customer_id,collected_at
    ) values(
      v_decision.id,v_decision.customer_id,v_decision.released_at
    ) on conflict (decision_id) do nothing;
  end if;
end
$legacy_release_scope$;
-- public.release_held_empties is an intentional SECURITY INVOKER shim;
-- it must be able to call this protected private helper. The helper itself
-- authorizes the verified active legacy owner before touching any row.
revoke all on function private.release_held_empties(uuid)
  from public,anon,service_role;
grant execute on function private.release_held_empties(uuid) to authenticated;

commit;
