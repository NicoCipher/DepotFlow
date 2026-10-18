-- M2f-16 (DRAFT ONLY): per-business sale/payment request identities.
-- Exact client UUIDs, immutable financial rows, receipt tokens and historical
-- ids are retained. New-business financial writes remain DISABLED.
-- Do not deploy until migration-history/production-clone preflight passes.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $request_identity_preflight$
declare v_sale text; v_payment text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into v_sale
  from pg_catalog.pg_constraint
  where conrelid='public.sales'::regclass
    and conname='sales_request_id_key' and contype='u';
  select pg_catalog.pg_get_constraintdef(oid) into v_payment
  from pg_catalog.pg_constraint
  where conrelid='public.customer_payments'::regclass
    and conname='customer_payments_request_id_key' and contype='u';
  if v_sale is distinct from 'UNIQUE (request_id)'
     or v_payment is distinct from 'UNIQUE (request_id)' then
    raise exception 'Unreviewed sale/payment request identity constraint: % / %',
      v_sale,v_payment;
  end if;
  if not exists (select 1 from pg_catalog.pg_attribute
    where attrelid='public.sales'::regclass and attname='business_id' and not attisdropped)
    or not exists (select 1 from pg_catalog.pg_attribute
    where attrelid='public.customer_payments'::regclass and attname='business_id' and not attisdropped) then
    raise exception 'Business identity is missing from a financial table';
  end if;
end;
$request_identity_preflight$;

-- A sale may legitimately predate request IDs: preserve multiple NULL
-- request_id rows while treating legacy NULL business tags as ONE tenant.
create unique index sales_business_request_unique
  on public.sales(business_id,request_id)
  nulls not distinct where request_id is not null;
alter table public.sales drop constraint sales_request_id_key;

-- Payment requests are always non-null. The NULLS NOT DISTINCT composite
-- key preserves the original single-shop semantics before legacy backfill.
alter table public.customer_payments
  add constraint customer_payments_business_request_unique
  unique nulls not distinct (business_id,request_id);
alter table public.customer_payments
  drop constraint customer_payments_request_id_key;

-- The cash/transfer/POS saver relies on the original money + stock saver,
-- and mixed tenders verify a linked old-debt receipt. A globally selected
-- payment request could attach another business's old-debt receipt instead.
do $scope_mixed_tender_debt_receipt$
declare
  v_oid oid := 'private.assert_sale_tender_complete()'::regprocedure;
  v_source text;
  v_sale_select constant text :=
    'select id,request_id,customer_id,paid_amount,payment_method,account_receipt';
  v_payment_select constant text :=
    E'where request_id=v_payment_id;';
begin
  v_source:=pg_catalog.pg_get_functiondef(v_oid);
  if v_source is null
    or (length(v_source)-length(replace(v_source,v_sale_select,'')))/length(v_sale_select)<>1
    or (length(v_source)-length(replace(v_source,v_payment_select,'')))/length(v_payment_select)<>1 then
    raise exception 'Immutable tender ledger verifier source drift';
  end if;
  v_source:=replace(v_source,v_sale_select,
    v_sale_select||',business_id');
  v_source:=replace(v_source,v_payment_select,
    E'where request_id=v_payment_id\n      and business_id is not distinct from v_sale.business_id;');
  execute v_source;
end;
$scope_mixed_tender_debt_receipt$;


-- The preceding 17141000 wrapper migration handles original-shop sale and old-debt
-- method/receipt lookups before these uniqueness constraints are relaxed.
-- Global recovery fences and new-business payment writers remain release gates.
commit;
