-- M2f-18: do not infer a mixed-tender old-debt receipt from a globally
-- reusable request UUID. The original sale's business is the authority.
-- Follow M2f-16 which intentionally permits two businesses to use the same
-- deterministic old-debt payment request UUID.
--
-- Draft only: no new-business saver grants or new tenants are activated.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $scope_mixed_debt_replays$
declare
  v_oid oid;
  v_source text;
  v_signature text;
  v_replay_old constant text :=
    E'where p.request_id=md5(\'depotflow:old-debt:\' || p_request_id::text)::uuid)';
  v_replay_new constant text :=
    E'where p.request_id=md5(\'depotflow:old-debt:\' || p_request_id::text)::uuid\n'
    || E'          and p.business_id is not distinct from v_saved.business_id)';
  v_derived_old constant text :=
    'where request_id=v_payment_id and customer_id=p_customer_id';
  v_derived_new constant text :=
    'where request_id=v_payment_id and customer_id=p_customer_id'
    || ' and private.can_read_legacy_customer(business_id)';
  v_hits int;
  v_patched int:=0;
begin
  for v_signature in
    select unnest(array[
      'public.save_sale_split_tender(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb)',
      'public.save_sale_multi_tender(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb)'
    ])
  loop
    v_oid:=pg_catalog.to_regprocedure(v_signature);
    if v_oid is null then
      raise exception 'Missing original-shop mixed-payment saver: %',v_signature;
    end if;
    v_source:=pg_catalog.pg_get_functiondef(v_oid);
    if pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
       or pg_catalog.strpos(v_source,'private.can_read_legacy_customer(business_id) for update')=0 then
      raise exception 'Mixed-payment saver lacks prerequisite owner and replay isolation: %',v_signature;
    end if;
    v_hits:=(pg_catalog.length(v_source)-pg_catalog.length(
      pg_catalog.replace(v_source,v_replay_old,'')))/pg_catalog.length(v_replay_old);
    if v_hits<>1 then
      raise exception 'Expected exactly one saved-payment replay subquery in %; got %',v_signature,v_hits;
    end if;
    v_source:=pg_catalog.replace(v_source,v_replay_old,v_replay_new);

    -- Both the method update and linked tender-leg payment lookup must
    -- resolve only this verified original business; never silently attach
    -- another shop's payment with the same derived request UUID.
    v_hits:=(pg_catalog.length(v_source)-pg_catalog.length(
      pg_catalog.replace(v_source,v_derived_old,'')))/pg_catalog.length(v_derived_old);
    if v_hits<>2 then
      raise exception 'Expected two derived-payment writer lookups in %; got %',v_signature,v_hits;
    end if;
    v_source:=pg_catalog.replace(v_source,v_derived_old,v_derived_new);

    execute v_source;
    v_patched:=v_patched+1;
  end loop;
  if v_patched<>2 then
    raise exception 'Both mixed-payment savers require scoped derived receipt queries';
  end if;
end;
$scope_mixed_debt_replays$;

commit;
