-- M2f-8: scope the original SECURITY DEFINER sale replay before it
-- returns any saved foreign sale ID, totals, or receipt-related metadata.
-- Guards the base legacy saver beneath both old public sale wrappers.
-- This is a draft-only additive hardening migration; no new-shop sales.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $guard_base_sale_replay$
declare
  v_oid oid := 'private.save_sale_v2(uuid,uuid,date,numeric,jsonb,jsonb,jsonb)'::regprocedure;
  v_source text;
  v_old_replay constant text :=
    'select * into v_sale from public.sales where request_id=p_request_id;';
  v_new_replay constant text :=
    'select * into v_sale from public.sales where request_id=p_request_id'
    || ' and private.can_read_legacy_customer(business_id);';
  v_old_customer constant text :=
    'select * into v_customer from public.customers where id=p_customer_id for share;';
  v_new_customer constant text :=
    'select * into v_customer from public.customers where id=p_customer_id'
    || ' and private.can_read_legacy_customer(business_id) for share;';
  v_replay_matches integer;
  v_customer_matches integer;
begin
  v_source := pg_catalog.pg_get_functiondef(v_oid);
  if v_source is null
     or pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
     or pg_catalog.strpos(v_source,v_new_replay)<>0
     or pg_catalog.strpos(v_source,v_new_customer)<>0 then
    raise exception 'Legacy base sale saver authorization/tenant source drift';
  end if;
  v_replay_matches := (
    length(v_source)-length(replace(v_source,v_old_replay,''))
  ) / length(v_old_replay);
  v_customer_matches := (
    length(v_source)-length(replace(v_source,v_old_customer,''))
  ) / length(v_old_customer);
  if v_replay_matches<>1 or v_customer_matches<>1 then
    raise exception 'Legacy sale replay/customer lookup drift: % / %',
      v_replay_matches,v_customer_matches;
  end if;
  v_source := replace(v_source,v_old_replay,v_new_replay);
  v_source := replace(v_source,v_old_customer,v_new_customer);
  execute v_source;
end;
$guard_base_sale_replay$;

-- A foreign or missing customer looks the same, including when the
-- caller provides a known foreign request ID. Original owner same-request
-- replays, accounting, stock, empties and idempotency remain unchanged.
commit;
