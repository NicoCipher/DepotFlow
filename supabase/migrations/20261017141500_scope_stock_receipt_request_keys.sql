-- M2f-20: scoped stock receiving/counting request history. A new depot
-- may reuse an idempotency UUID without altering another depot's receipts.
-- Release candidate only: not a new receiving permission or production DDL.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $stock_request_key_preflight$
declare
  v_receipt text;
  v_movement text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into v_receipt
    from pg_catalog.pg_constraint
   where conrelid='private.stock_receipts'::regclass
     and conname='stock_receipts_pkey' and contype='p';
  select pg_catalog.pg_get_constraintdef(oid) into v_movement
    from pg_catalog.pg_constraint
   where conrelid='public.stock_movements'::regclass
     and conname='stock_movements_request_id_key' and contype='u';
  if v_receipt is distinct from 'PRIMARY KEY (request_id)'
     or v_movement is distinct from 'UNIQUE (request_id)' then
    raise exception 'Unreviewed receiving/stock request keys % / %',
      v_receipt,v_movement;
  end if;
  if exists(
    select 1 from pg_catalog.pg_constraint
    where contype='f' and confrelid='private.stock_receipts'::regclass
  ) then
    raise exception 'Stock receipt table acquired new referencing FKs';
  end if;
end;
$stock_request_key_preflight$;

-- Preserve every historic request UUID and stock activity ID. NULLS NOT
-- DISTINCT ensures the original shop's unbackfilled history stays unique.
alter table private.stock_receipts
  add column receipt_id uuid not null default pg_catalog.gen_random_uuid();
alter table private.stock_receipts drop constraint stock_receipts_pkey;
alter table private.stock_receipts
  add constraint stock_receipts_pkey primary key (receipt_id);
alter table private.stock_receipts
  add constraint stock_receipts_business_request_unique
  unique nulls not distinct (business_id,request_id);

alter table public.stock_movements
  drop constraint stock_movements_request_id_key;
alter table public.stock_movements
  add constraint stock_movements_business_request_unique
  unique nulls not distinct (business_id,request_id);

-- Existing single-owner stock receiving and physical-count RPCs must not
-- replay a foreign receipt/movement now that two shops can use one UUID.
do $guard_legacy_stock_request_replays$
declare
  v_oid oid;
  v_source text;
  v_signature text;
  v_old_receipt constant text :=
    'from private.stock_receipts where request_id = p_request_id;';
  v_new_receipt constant text :=
    'from private.stock_receipts where request_id = p_request_id'
    || ' and private.can_read_legacy_customer(business_id);';
  v_old_movement constant text :=
    'from public.stock_movements where request_id=p_request_id';
  v_new_movement constant text :=
    'from public.stock_movements where request_id=p_request_id'
    || ' and private.can_read_legacy_customer(business_id)';
  v_alt_receipt constant text :=
    'from private.stock_receipts where request_id=p_request_id';
  v_alt_receipt_new constant text :=
    'from private.stock_receipts where request_id=p_request_id'
    || ' and private.can_read_legacy_customer(business_id)';
  v_hits int;
begin
  for v_signature in
    select unnest(array[
      'private.receive_stock(uuid,uuid,numeric,integer,integer,integer,uuid,date)',
      'private.set_current_stock(uuid,uuid,numeric,numeric,date,integer,integer)'
    ])
  loop
    v_oid:=pg_catalog.to_regprocedure(v_signature);
    if v_oid is null then raise exception 'Legacy stock RPC missing %',v_signature;end if;
    v_source:=pg_catalog.pg_get_functiondef(v_oid);
    if pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
       or pg_catalog.strpos(v_source,'private.can_read_legacy_customer(')<>0 then
      raise exception 'Legacy stock owner authorization/replay source drift: %',v_signature;
    end if;

    if pg_catalog.strpos(v_signature,'private.receive_stock(')=1 then
      v_hits:=(length(v_source)-length(replace(v_source,v_old_receipt,'')))
        /length(v_old_receipt);
      if v_hits<>1 then raise exception 'Expected one receiving replay, got %',v_hits;end if;
      v_source:=replace(v_source,v_old_receipt,v_new_receipt);
      v_hits:=(length(v_source)-length(replace(v_source,v_old_movement,'')))
        /length(v_old_movement);
      if v_hits<>1 then raise exception 'Expected one receiving movement probe, got %',v_hits;end if;
      v_source:=replace(v_source,v_old_movement,v_new_movement);
    else
      v_hits:=(length(v_source)-length(replace(v_source,v_old_movement,'')))
        /length(v_old_movement);
      if v_hits<>1 then raise exception 'Expected one stock count replay, got %',v_hits;end if;
      v_source:=replace(v_source,v_old_movement,v_new_movement);
      v_hits:=(length(v_source)-length(replace(v_source,v_alt_receipt,'')))
        /length(v_alt_receipt);
      if v_hits<>1 then raise exception 'Expected one stock receipt collision probe, got %',v_hits;end if;
      v_source:=replace(v_source,v_alt_receipt,v_alt_receipt_new);
    end if;
    execute v_source;
  end loop;
end;
$guard_legacy_stock_request_replays$;
commit;
