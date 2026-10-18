-- M2 integration: close authorization oracles in legacy write RPCs.
-- Guard before validation, data reads, state probes, and idempotent replays.
-- Table-write triggers alone do NOT protect read/return paths inside
-- SECURITY DEFINER routines. Exact routine allowlist deliberately fails
-- deployment if one known public/private write API disappears or drifts.
-- Public verification-by-token must remain callable by anon.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $guard_write_entrypoints$
declare
  r record;
  v_oid oid;
  v_source text;
  v_begin integer;
  v_body_head text;
  v_count integer:=0;
  v_guard constant text :=
    E'\nbegin\n  if not private.verified_legacy_owner_read() then\n'
    || E'    raise exception using errcode=\'42501\', message=\'Owner only\';\n'
    || E'  end if;\n';
begin
  for r in
    select signature from (values
      ('private.create_crate_type(uuid,text,text,numeric,text)'),
      ('private.delete_unused_crate_type(uuid)'),
      ('private.edit_crate_type(uuid,text,text,numeric,text)'),
      ('private.receive_stock(uuid,uuid,numeric,integer,integer,integer,uuid,date)'),
      ('private.record_opening_balances(uuid,uuid,numeric,date,text,jsonb,jsonb)'),
      ('private.record_payment(uuid,uuid,numeric,date)'),
      ('private.release_held_empties(uuid)'),
      ('private.save_sale_v2(uuid,uuid,date,numeric,jsonb,jsonb,jsonb)'),
      ('private.set_bottle_deposit_price(numeric)'),
      ('private.set_crate_deposit_price(numeric,numeric,numeric)'),
      ('private.set_crate_swap_rules(uuid,uuid[])'),
      ('private.set_current_stock(uuid,uuid,numeric,numeric,date,integer,integer)'),
      ('private.set_empty_crate_count(uuid,uuid,numeric,date,integer)'),
      ('public.save_sale_v2(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,text)'),
      ('public.save_sale_with_old_debt_payment(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,text,numeric)')
    ) as entrypoints(signature)
  loop
    v_oid := pg_catalog.to_regprocedure(r.signature);
    if v_oid is null or not exists(
      select 1 from pg_catalog.pg_proc p
      where p.oid=v_oid and p.prosecdef and
        p.prolang=(select oid from pg_catalog.pg_language where lanname='plpgsql')
    ) then
      raise exception 'Expected privileged legacy write RPC missing or changed: %',r.signature;
    end if;
    v_source := pg_catalog.pg_get_functiondef(v_oid);
    v_begin := pg_catalog.strpos(v_source,E'\nbegin\n');
    if v_begin=0 then
      raise exception 'Expected top-level PL/pgSQL BEGIN missing: %',r.signature;
    end if;
    v_body_head:=pg_catalog.substr(v_source,v_begin,390);
    -- Require the EXISTING direct singleton guard at the START of the
    -- routine before modifying its definition. Never match later comments.
    if pg_catalog.strpos(v_body_head,E'\nbegin\n  if')<>1
       or pg_catalog.strpos(v_body_head,'private.shop_owner')=0
       or pg_catalog.strpos(v_body_head,'auth.uid()')=0
       or pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')<>0 then
       raise exception 'Legacy write authorization drift detected: %',r.signature;
    end if;
    execute pg_catalog.substr(v_source,1,v_begin-1)
      ||v_guard
      ||pg_catalog.substr(v_source,v_begin+pg_catalog.length(E'\nbegin\n'));
    v_count:=v_count+1;
  end loop;
  if v_count<>15 then
    raise exception 'Expected exactly 15 legacy write RPCs, found %',v_count;
  end if;
end;
$guard_write_entrypoints$;
commit;
