-- M2f-22: make the business stock-count/receiving request namespace
-- symmetric. An ID already used to RECEIVE cannot subsequently COUNT stock
-- (even when the count happens to leave the quantity unchanged).
-- The receiving path already rejects IDs previously used by a stock count.
-- Both writers serialize on the SAME (business_id, request_id) advisory lock.
-- Draft only; no grants, gates or production operations are changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $scope_stock_count_request_namespace$
declare
  v_oid oid := 'public.count_business_product_stock(uuid,uuid,uuid,numeric,numeric,integer,integer,date)'::regprocedure;
  v_source text;
  v_anchor constant text :=
    '  select * into v_event from private.business_product_stock_counts';
  v_insert constant text := $guard$
  -- Receive/Count are different physical operations, not interchangeable
  -- idempotent retries. Check the shared namespace UNDER the same request
  -- advisory lock used in receive_business_stock.
  if exists (
    select 1 from private.business_receiving_requests
    where business_id=p_business_id and request_id=p_request_id
  ) then
    raise exception 'This request ID was already used for stock receiving'
      using errcode='22023';
  end if;

$guard$;
  v_hits integer;
begin
  select pg_catalog.pg_get_functiondef(v_oid) into v_source;
  if v_source is null
     or pg_catalog.strpos(v_source,'private.business_product_stock_count_gate')=0
     or pg_catalog.strpos(v_source,'pg_catalog.pg_advisory_xact_lock')=0
     or pg_catalog.strpos(v_source,'private.business_receiving_requests')<>0 then
    raise exception 'Business stock-count source changed; manual review required';
  end if;
  v_hits := (
    pg_catalog.length(v_source) -
    pg_catalog.length(pg_catalog.replace(v_source,v_anchor,''))
  ) / pg_catalog.length(v_anchor);
  if v_hits<>1 then
    raise exception 'Expected one stock-count event lookup; found %',v_hits;
  end if;
  execute pg_catalog.replace(v_source,v_anchor,v_insert||v_anchor);
end;
$scope_stock_count_request_namespace$;
commit;
