-- M2f-2: SECURITY DEFINER bypasses RLS, so the original shop reports
-- must filter operational records by verified legacy business identity.
-- Preserve existing report JSON contracts, totals, labels and sort order.
-- Fail the migration if upstream report SQL drifts from the reviewed shape.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $tenant_report_guard$
declare
  v_source text;
  v_old text;
  v_new text;
  v_seen integer;
  r record;
begin
  v_source:=pg_catalog.pg_get_functiondef(
    'public.manager_snapshot(date)'::regprocedure);
  if pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
     or pg_catalog.strpos(v_source,'private.can_read_legacy_customer(')<>0 then
    raise exception 'Unexpected manager_snapshot authorization before inventory isolation';
  end if;

  for r in
    select * from (values
      ('from public.sales where business_date=p_day',
       'from public.sales where business_date=p_day and private.can_read_legacy_customer(business_id)',3),
      ('from public.customer_payments where business_date=p_day',
       'from public.customer_payments where business_date=p_day and private.can_read_legacy_customer(business_id)',1),
      ('from public.money_owed)',
       'from public.money_owed where private.can_read_legacy_customer(business_id))',1),
      ('from public.money_owed where amount>0)',
       'from public.money_owed where amount>0 and private.can_read_legacy_customer(business_id))',1),
      ('where p.is_active is true',
       'where private.can_read_legacy_customer(p.business_id) and p.is_active is true',2)
    ) as patterns(old_text,new_text,expected_hits)
  loop
    v_seen:=(pg_catalog.length(v_source)
       -pg_catalog.length(pg_catalog.replace(v_source,r.old_text,'')))
       / pg_catalog.length(r.old_text);
    if v_seen<>r.expected_hits then
      raise exception 'Dashboard source drift: %, expected % matches, got %',
        r.old_text,r.expected_hits,v_seen;
    end if;
    v_source:=pg_catalog.replace(v_source,r.old_text,r.new_text);
  end loop;
  execute v_source;

  v_source:=pg_catalog.pg_get_functiondef(
    'public.store_activity(date,date,uuid,text,integer,integer)'::regprocedure);
  if pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
     or pg_catalog.strpos(v_source,'private.can_read_legacy_customer(c.business_id)')=0
     or pg_catalog.strpos(v_source,
       'private.can_read_legacy_customer(m.business_id)')<>0 then
    raise exception 'Activity report authorization/customer filters drifted';
  end if;
  for r in
    select * from (values
      ('from public.stock_movements m where m.business_date between p_from and p_to',
       'from public.stock_movements m where m.business_date between p_from and p_to and private.can_read_legacy_customer(m.business_id)',1),
      ('from public.empty_crate_movements m where m.business_date between p_from and p_to',
       'from public.empty_crate_movements m where m.business_date between p_from and p_to and private.can_read_legacy_customer(m.business_id)',1)
    ) as patterns(old_text,new_text,expected_hits)
  loop
    v_seen:=(pg_catalog.length(v_source)
       -pg_catalog.length(pg_catalog.replace(v_source,r.old_text,'')))
       / pg_catalog.length(r.old_text);
    if v_seen<>r.expected_hits then
      raise exception 'Activity report source drift: %, got %',
        r.old_text,v_seen;
    end if;
    v_source:=pg_catalog.replace(v_source,r.old_text,r.new_text);
  end loop;
  execute v_source;
end;
$tenant_report_guard$;
commit;
