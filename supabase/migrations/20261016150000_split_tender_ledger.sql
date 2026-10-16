begin;

-- Strictly additive split-tender ledger. Existing Cash / Transfer / POS sales
-- remain unchanged and intentionally have no child tender legs.
alter table public.sales drop constraint sales_payment_method_check;
alter table public.sales add constraint sales_payment_method_check
  check (payment_method in ('cash','transfer','pos','not_recorded','mixed'));
alter table public.customer_payments drop constraint customer_payments_method_check;
alter table public.customer_payments add constraint customer_payments_method_check
  check (method in ('cash','transfer','pos','not_recorded','mixed'));

create table public.sale_tender_legs (
  sale_id uuid not null references public.sales(id) on delete restrict,
  method text not null check (method in ('cash','transfer')),
  sale_amount integer not null check (sale_amount >= 0),
  old_debt_amount integer not null check (old_debt_amount >= 0),
  old_debt_payment_id uuid references public.customer_payments(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (sale_id, method),
  constraint sale_tender_positive_amount check (sale_amount + old_debt_amount > 0),
  constraint sale_tender_old_debt_link check (
    (old_debt_amount = 0 and old_debt_payment_id is null) or
    (old_debt_amount > 0 and old_debt_payment_id is not null)
  )
);
create index sale_tender_old_debt_receipt_idx on public.sale_tender_legs(old_debt_payment_id)
  where old_debt_payment_id is not null;

alter table public.sale_tender_legs enable row level security;
revoke all on public.sale_tender_legs from public, anon, authenticated;
grant select on public.sale_tender_legs to authenticated;
create policy owner_read on public.sale_tender_legs for select to authenticated
  using ((select public.is_shop_owner()));

-- A ledger row is never rewritten or discarded, including by a future
-- security-definer RPC. Financial corrections need new compensating records.
create function private.reject_sale_tender_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception using errcode='22023', message='Recorded tender legs are immutable.';
end;
$$;
create trigger sale_tender_immutable before update or delete on public.sale_tender_legs
  for each row execute function private.reject_sale_tender_mutation();

-- At end of the transaction, a mixed sale must have exactly Cash and Transfer
-- legs. Both allocations must match authoritative sale/old-debt ledger values,
-- not untrusted client totals. A mixed method cannot be set without legs.
create function private.assert_sale_tender_complete()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_sale_id uuid;
  v_sale record;
  v_count integer;
  v_paid_sale bigint;
  v_paid_old bigint;
  v_cash_old integer;
  v_transfer_old integer;
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
    coalesce(sum(old_debt_amount) filter (where method='cash'),0),
    coalesce(sum(old_debt_amount) filter (where method='transfer'),0)
  into v_count,v_paid_sale,v_paid_old,v_cash_old,v_transfer_old
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
  if v_count <> 2 or v_paid_sale <> v_sale.paid_amount or
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
    when v_cash_old>0 and v_transfer_old>0 then 'mixed'
    when v_cash_old>0 then 'cash'
    else 'transfer'
  end;
  if v_payment.method <> v_expected_payment_method then
    raise exception using errcode='22023', message='Old-debt receipt tender methods do not match.';
  end if;
  return null;
end;
$$;

create constraint trigger sale_tender_complete_on_leg
  after insert on public.sale_tender_legs
  deferrable initially deferred for each row
  execute function private.assert_sale_tender_complete();
create constraint trigger sale_tender_complete_on_mixed_sale
  after insert or update of payment_method on public.sales
  deferrable initially deferred for each row
  execute function private.assert_sale_tender_complete();

-- The mixed writer and public verification additions are separate reviewed
-- changes. DO NOT treat this table as permission to enable split UI yet.
commit;
