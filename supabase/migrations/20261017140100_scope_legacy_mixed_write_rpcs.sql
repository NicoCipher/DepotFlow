-- M2f-6: retrofit NEW production mixed-payment RPCs created after the M2
-- legacy-write allowlist. Otherwise the original shop owner could replay
-- a foreign sale or recover its request ID through SECURITY DEFINER code.
-- Scoped after the real deployed mixed-tender migrations. No new tenants
-- are allowed to write sales. This is a release-candidate migration only.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $guard_new_mixed_savers$
declare
  r record;
  v_oid oid;
  v_source text;
  v_old_owner constant text :=
    E'if (select auth.uid()) is null\n    or not exists (select 1 from private.shop_owner\n                   where user_id=(select auth.uid())) then';
  v_new_owner constant text := 'if not private.verified_legacy_owner_read() then';
  v_old_replay constant text :=
    E'from public.sales\n    where request_id=p_request_id for update;';
  v_new_replay constant text :=
    E'from public.sales\n    where request_id=p_request_id\n      and private.can_read_legacy_customer(business_id) for update;';
  v_mark constant text :=
    E'  -- A previous split saver in the same transaction may have made checks';
  v_customer_guard constant text :=
    E'  -- Reject cross-business customers before any amount, debt, replay or stock probe.\n'
    || E'  if p_customer_id is not null and not exists (\n'
    || E'    select 1 from public.customers where id=p_customer_id\n'
    || E'      and private.can_read_legacy_customer(business_id)\n'
    || E'  ) then\n'
    || E'    raise exception using errcode=\'22023\',message=\'Customer no longer exists.\';\n'
    || E'  end if;\n\n';
  v_fixed int:=0;
begin
  for r in
    select signature from (values
      ('public.save_sale_split_tender(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb)'),
      ('public.save_sale_multi_tender(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb)')
    ) a(signature)
  loop
    v_oid:=pg_catalog.to_regprocedure(r.signature);
    if v_oid is null then
      raise exception 'Missing current mixed saver %',r.signature;
    end if;
    select pg_catalog.pg_get_functiondef(v_oid) into v_source;
    if v_source is null or
       (length(v_source)-length(replace(v_source,v_old_owner,'')))/length(v_old_owner)<>1 or
       (length(v_source)-length(replace(v_source,v_old_replay,'')))/length(v_old_replay)<>1 or
       (length(v_source)-length(replace(v_source,v_mark,'')))/length(v_mark)<>1 or
       pg_catalog.strpos(v_source,'private.can_read_legacy_customer(')<>0 then
      raise exception 'Mixed saver authorization drift; manual review: %',r.signature;
    end if;
    v_source:=replace(v_source,v_old_owner,v_new_owner);
    v_source:=replace(v_source,v_old_replay,v_new_replay);
    v_source:=replace(v_source,v_mark,v_customer_guard||v_mark);
    execute v_source;
    v_fixed:=v_fixed+1;
  end loop;
  if v_fixed<>2 then
    raise exception 'Expected two guarded mixed savers, found %',v_fixed;
  end if;
end;
$guard_new_mixed_savers$;

-- A status RPC is ALSO a privileged read/write API: an attacker who knows a
-- foreign request UUID may not see a sale ID OR write a global fence to it.
-- For such an ID, return the same "absent for this shop" response WITHOUT
-- inserting a fence that would deny a later write in the other shop.
do $guard_mixed_recovery$
declare
  v_oid oid:='public.check_split_sale_request(uuid)'::regprocedure;
  v_source text;
  v_old_owner constant text :=
    E'if (select auth.uid()) is null or not exists (\n'
    || E'    select 1 from private.shop_owner where user_id=(select auth.uid())\n'
    || E'  ) then';
  v_old_select constant text :=
    E'select id, payment_method, split_request_hash into v_sale\n'
    || E'    from public.sales where request_id=p_request_id;';
  v_new_select constant text :=
    E'select id, payment_method, split_request_hash, business_id into v_sale\n'
    || E'    from public.sales where request_id=p_request_id;\n'
    || E'  if found and not private.can_read_legacy_customer(v_sale.business_id) then\n'
    || E'    -- Foreign request IDs MUST NOT be globally fenced.\n'
    || E'    return jsonb_build_object(\'state\',\'absent\');\n'
    || E'  end if;';
begin
  select pg_catalog.pg_get_functiondef(v_oid) into v_source;
  if v_source is null or
    (length(v_source)-length(replace(v_source,v_old_owner,'')))/length(v_old_owner)<>1 or
    (length(v_source)-length(replace(v_source,v_old_select,'')))/length(v_old_select)<>1 or
    pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')<>0 then
    raise exception 'Mixed recovery authorization drift; manual review required';
  end if;
  v_source:=replace(v_source,v_old_owner,
    'if not private.verified_legacy_owner_read() then');
  v_source:=replace(v_source,v_old_select,v_new_select);
  execute v_source;
end;
$guard_mixed_recovery$;

commit;
