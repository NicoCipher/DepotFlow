-- M2f-25: saved stock operations must replay before mutable product checks.
-- No gate, grant, receipt, quantity, or price changes; draft migration only.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- count_business_product_stock already fences RECEIVE/COUNT request collision
-- under the same advisory lock. Keep that protection with replay moved first.
do $scope_replay_count$
declare
  v_oid oid := 'public.count_business_product_stock(uuid,uuid,uuid,numeric,numeric,integer,integer,date)'::regprocedure;
  v_src text;
  v_metadata_start int;
  v_lock_start int;
  v_stock_start int;
  v_metadata text;
  v_replay text;
begin
  v_src:=pg_catalog.pg_get_functiondef(v_oid);
  v_metadata_start:=pg_catalog.strpos(v_src,'  -- Lock exact product metadata before deriving physical stock total.');
  v_lock_start:=pg_catalog.strpos(v_src,'  perform pg_catalog.pg_advisory_xact_lock(');
  v_stock_start:=pg_catalog.strpos(v_src,'  select total_bottles into v_current');
  if v_src is null or v_metadata_start=0 or v_lock_start=0
     or v_stock_start=0 or not (v_metadata_start<v_lock_start and v_lock_start<v_stock_start)
     or pg_catalog.strpos(v_src,'private.business_receiving_requests')=0
     or pg_catalog.strpos(v_src,'select * into v_event from private.business_product_stock_counts')=0 then
    raise exception 'Count replay source changed; independent review required';
  end if;
  v_metadata:=pg_catalog.substr(v_src,v_metadata_start,v_lock_start-v_metadata_start);
  v_replay:=pg_catalog.substr(v_src,v_lock_start,v_stock_start-v_lock_start);
  -- Owner and gate authorization still happen before the saved-request lookup.
  -- Even a now-retired product, changed pack size, or stale physical total
  -- may return its ORIGINAL matching immutable result (no new side effects).
  execute pg_catalog.substr(v_src,1,v_metadata_start-1)
    ||v_replay||v_metadata||pg_catalog.substr(v_src,v_stock_start);
end;
$scope_replay_count$;

do $scope_replay_receiving$
declare
  v_oid oid := 'public.receive_business_stock(uuid,uuid,uuid,numeric,integer,integer,integer,uuid,date)'::regprocedure;
  v_src text;
  v_metadata_start int;
  v_lock_start int;
  v_stock_start int;
  v_metadata text;
  v_replay text;
begin
  v_src:=pg_catalog.pg_get_functiondef(v_oid);
  v_metadata_start:=pg_catalog.strpos(v_src,'  -- The original product and crate UUIDs must belong to the selected');
  v_lock_start:=pg_catalog.strpos(v_src,'  perform pg_catalog.pg_advisory_xact_lock(');
  v_stock_start:=pg_catalog.strpos(v_src,'  -- Current crate inventory must be locked before product stock');
  if v_src is null or v_metadata_start=0 or v_lock_start=0
     or v_stock_start=0 or not (v_metadata_start<v_lock_start and v_lock_start<v_stock_start)
     or pg_catalog.strpos(v_src,'select * into v_prior from private.business_receiving_requests')=0
     or pg_catalog.strpos(v_src,'private.business_product_stock_counts')=0 then
    raise exception 'Receiving replay source changed; independent review required';
  end if;
  v_metadata:=pg_catalog.substr(v_src,v_metadata_start,v_lock_start-v_metadata_start);
  v_replay:=pg_catalog.substr(v_src,v_lock_start,v_stock_start-v_lock_start);
  execute pg_catalog.substr(v_src,1,v_metadata_start-1)
    ||v_replay||v_metadata||pg_catalog.substr(v_src,v_stock_start);
end;
$scope_replay_receiving$;
commit;
