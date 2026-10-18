-- M2f-15 (DRAFT ONLY): per-business sale/payment request identities.
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

-- The public direct-sale wrapper must only update the SAME original shop's
-- saved payment method. Global request_id used to be a sufficient join key;
-- it is NOT sufficient after tenant-qualified uniqueness.
do $scope_legacy_direct_sale_wrapper$
declare
  v_oid oid := 'public.save_sale_v2(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,text)'::regprocedure;
  v_source text;
  v_old_method constant text :=
    'select payment_method into v_method from public.sales where request_id=p_request_id for update;';
  v_new_method constant text :=
    'select payment_method into v_method from public.sales where request_id=p_request_id and private.can_read_legacy_customer(business_id) for update;';
  v_old_update constant text :=
    E'where request_id=p_request_id and payment_method=\'not_recorded\';';
  v_new_update constant text :=
    E'where request_id=p_request_id and payment_method=\'not_recorded\' and private.can_read_legacy_customer(business_id);';
begin
  v_source:=pg_catalog.pg_get_functiondef(v_oid);
  if v_source is null
    or pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
    or (length(v_source)-length(replace(v_source,v_old_method,'')))/length(v_old_method)<>1
    or (length(v_source)-length(replace(v_source,v_old_update,'')))/length(v_old_update)<>1 then
    raise exception 'Legacy direct-sale method-scoping drift';
  end if;
  v_source:=replace(v_source,v_old_method,v_new_method);
  v_source:=replace(v_source,v_old_update,v_new_update);
  execute v_source;
end;
$scope_legacy_direct_sale_wrapper$;

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

-- Repair all original-shop combined checkout lookups before a collision
-- can reach method comparisons, debt receipt snapshots or replay branches.
do $scope_legacy_combined_debt_checkout$
declare
  v_oid oid := 'public.save_sale_with_old_debt_payment(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,text,numeric)'::regprocedure;
  v_source text;
  r record;
  n integer;
  hits integer:=0;
begin
  v_source:=pg_catalog.pg_get_functiondef(v_oid);
  if v_source is null
    or pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
    or pg_catalog.strpos(v_source,'private.can_read_legacy_customer(')<>0 then
    raise exception 'Combined debt checkout authorization/source drift';
  end if;
  for r in select * from (values
    (
      'select account_receipt into v_snapshot from public.sales where request_id = p_request_id;',
      'select account_receipt into v_snapshot from public.sales where request_id = p_request_id and private.can_read_legacy_customer(business_id);',1
    ),
    (
      'select 1 from public.sales where request_id = p_request_id)',
      'select 1 from public.sales where request_id = p_request_id and private.can_read_legacy_customer(business_id))',1
    ),
    (
      'select 1 from public.customer_payments where request_id = v_payment_request_id)',
      'select 1 from public.customer_payments where request_id = v_payment_request_id and private.can_read_legacy_customer(business_id))',2
    ),
    (
      'from public.customer_payments where request_id = v_payment_request_id;',
      'from public.customer_payments where request_id = v_payment_request_id and private.can_read_legacy_customer(business_id);',1
    ),
    (
      'from public.money_owed\n    where customer_id = p_customer_id for update;',
      'from public.money_owed\n    where customer_id = p_customer_id and private.can_read_legacy_customer(business_id) for update;',1
    )
  ) a(old_text,new_text,expected_hits)
  loop
    n := (length(v_source)-length(replace(v_source,r.old_text,'')))/length(r.old_text);
    if n<>r.expected_hits then
      raise exception 'Combined checkout request scoping drift: %, hits %, expected %',
        pg_catalog.left(r.old_text,90),n,r.expected_hits;
    end if;
    v_source:=replace(v_source,r.old_text,r.new_text);
    hits:=hits+n;
  end loop;
  if hits<>6 then raise exception 'Combined checkout request scope coverage %',hits;end if;
  execute v_source;
end;
$scope_legacy_combined_debt_checkout$;

-- Existing recovery fences remain GLOBAL and new-business sales/receipt
-- writers remain closed. Those need a separate verified business-keyed
-- fence and full write-path review BEFORE any new-shop checkout release.
commit;
