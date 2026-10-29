-- Allow a cost value to recur later in the same business day without rewriting history.
-- Each event is tied to the RPC's idempotency request; the request table still rejects
-- replay with a different payload, and product row locks serialize competing updates.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.product_cost_history add column if not exists source_request_id uuid;

-- Remove only the old uniqueness rule that treats a repeated cost value on the
-- same business/date/catalogue as a duplicate event. Keep all other unique keys.
do $drop_cost_value_uniqueness$
declare r record;
begin
  for r in
    select i.indexrelid::regclass as index_name,
           c.conname as constraint_name,
           array_agg(a.attname::text order by a.attname::text)
             filter (where k.ordinality <= i.indnkeyatts) as key_columns
    from pg_catalog.pg_index i
    join pg_catalog.pg_class t on t.oid=i.indrelid
    join pg_catalog.pg_namespace n on n.oid=t.relnamespace
    cross join lateral unnest(i.indkey) with ordinality as k(attnum,ordinality)
    join pg_catalog.pg_attribute a on a.attrelid=t.oid and a.attnum=k.attnum
    left join pg_catalog.pg_constraint c on c.conindid=i.indexrelid and c.contype='u'
    where n.nspname='public' and t.relname='product_cost_history'
      and i.indisunique and not i.indisprimary and i.indpred is null
    group by i.indexrelid,c.conname,i.indnkeyatts
    having array_agg(a.attname::text order by a.attname::text)
             filter (where k.ordinality <= i.indnkeyatts)
           in (
             array['business_id','catalogue_product_id','cost_price','effective_on']::text[],
             array['business_id','catalogue_product_id','cost_price','effective_on','owner_user_id']::text[]
           )
  loop
    if r.constraint_name is not null then
      execute format('alter table public.product_cost_history drop constraint %I',r.constraint_name);
    else
      execute format('drop index %s',r.index_name);
    end if;
  end loop;
end;
$drop_cost_value_uniqueness$;

-- Enforce one history event per request/catalogue/business, without forbidding
-- a later request from restoring a previously used cost value.
create unique index if not exists product_cost_history_source_request_uidx
  on public.product_cost_history(owner_user_id,business_id,catalogue_product_id,source_request_id)
  where source_request_id is not null;

create or replace function public.update_legacy_product_prices(
  p_request_id uuid,
  p_changes jsonb
) returns jsonb
language plpgsql volatile security definer set search_path=''
as $bulk_prices$
declare
  v_actor uuid := private.assert_legacy_assortment_owner();
  v_business uuid;
  v_saved private.legacy_price_update_requests%rowtype;
  v_item jsonb;
  v_product public.products%rowtype;
  v_catalogue uuid;
  v_change_selling boolean;
  v_change_cost boolean;
  v_expected_full integer;
  v_new_full integer;
  v_expected_bottle integer;
  v_new_bottle integer;
  v_expected_half integer;
  v_new_half integer;
  v_expected_quarter integer;
  v_new_quarter integer;
  v_expected_cost integer;
  v_new_cost integer;
  v_current_cost integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_result jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_id uuid;
begin
  if p_request_id is null or jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Choose at least one price change.' using errcode='22023';
  end if;
  if jsonb_array_length(p_changes) not between 1 and 500 then
    raise exception 'Choose at least one price change.' using errcode='22023';
  end if;

  -- This legacy-only editor is unavailable until the audited write-scope
  -- gate has been explicitly enabled. Never interpret a missing/disabled gate
  -- as permission to write products whose business_id is NULL.
  select g.business_id into v_business
  from private.legacy_write_scope_gate g
  join private.businesses b on b.id=g.business_id and b.legacy_singleton is true
  join private.business_memberships m on m.business_id=b.id
    and m.user_id=v_actor and m.member_kind='owner' and m.status='active'
  where g.enabled is true and b.status='active'
  for share of g;
  if not found or v_business is null then
    raise exception 'Price updates are not enabled for this shop yet.'
      using errcode='42501';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_changes) as entry(value)
    group by entry.value->>'product_id'
    having count(*) > 1
  ) then
    raise exception 'A drink appears more than once. Review the list and try again.'
      using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('legacy-price-update:'||v_actor::text||':'||p_request_id::text,0)
  );
  select * into v_saved from private.legacy_price_update_requests
    where owner_id=v_actor and request_id=p_request_id for update;
  if found then
    if v_saved.payload is distinct from p_changes then
      raise exception 'This save request was already used with different prices. Review and save again.'
        using errcode='22023';
    end if;
    return v_saved.result;
  end if;

  -- Lock products in a stable order so overlapping batches do not deadlock.
  for v_item in
    select value from jsonb_array_elements(p_changes)
    order by value->>'product_id'
  loop
    begin
      v_id := (v_item->>'product_id')::uuid;
    exception when others then
      raise exception 'A drink could not be identified. Refresh the price list.'
        using errcode='22023';
    end;
    v_change_selling := coalesce((v_item->>'change_selling')::boolean,false);
    v_change_cost := coalesce((v_item->>'change_cost')::boolean,false);
    if not v_change_selling and not v_change_cost then
      raise exception 'No price change was selected.' using errcode='22023';
    end if;

    select * into v_product from public.products p
    where p.id=v_id and p.is_active is true
      and ((v_business is null and p.business_id is null)
        or (v_business is not null and p.business_id=v_business))
    for update;
    if not found then
      raise exception 'A drink is no longer available in this shop. Refresh the price list.'
        using errcode='40001';
    end if;

    if v_change_selling then
      v_expected_full := (v_item->>'expected_full_crate_price')::integer;
      v_new_full := (v_item->>'new_full_crate_price')::integer;
      if v_expected_full is distinct from v_product.full_crate_price
         or v_new_full is null or v_new_full < 0 or v_new_full > 2147483600
         or v_new_full % 50 <> 0 then
        raise exception 'A selling price changed elsewhere or is invalid. Refresh and review again.'
          using errcode='40001';
      end if;
      v_expected_bottle := nullif(v_item->>'expected_bottle_price','')::integer;
      v_new_bottle := nullif(v_item->>'new_bottle_price','')::integer;
      v_expected_half := nullif(v_item->>'expected_half_crate_price','')::integer;
      v_new_half := nullif(v_item->>'new_half_crate_price','')::integer;
      v_expected_quarter := nullif(v_item->>'expected_quarter_crate_price','')::integer;
      v_new_quarter := nullif(v_item->>'new_quarter_crate_price','')::integer;
      if v_expected_bottle is distinct from v_product.bottle_price
         or (v_new_bottle is not null and
             (v_new_bottle < 0 or v_new_bottle > 2147483600 or v_new_bottle % 50 <> 0)) then
        raise exception 'A bottle price changed elsewhere or is invalid. Refresh and review again.'
          using errcode='40001';
      end if;
      if v_expected_half is distinct from v_product.half_crate_price
         or (v_new_half is not null and
             (v_new_half < 0 or v_new_half > 2147483600 or v_new_half % 50 <> 0))
         or v_expected_quarter is distinct from v_product.quarter_crate_price
         or (v_new_quarter is not null and
             (v_new_quarter < 0 or v_new_quarter > 2147483600 or v_new_quarter % 50 <> 0)) then
        raise exception 'A pack price changed elsewhere or is invalid. Refresh and review again.'
          using errcode='40001';
      end if;
      update public.products
      set full_crate_price=v_new_full, bottle_price=v_new_bottle,
          half_crate_price=v_new_half, quarter_crate_price=v_new_quarter
      where id=v_id;
    end if;

    if v_change_cost then
      v_catalogue := nullif(v_item->>'catalogue_product_id','')::uuid;
      v_expected_cost := nullif(v_item->>'expected_cost_price','')::integer;
      v_new_cost := nullif(v_item->>'new_cost_price','')::integer;
      if v_catalogue is null or v_product.catalogue_product_id is distinct from v_catalogue
         or v_new_cost is null or v_new_cost < 0 or v_new_cost > 2147483600 then
        raise exception 'Buying cost can only be updated for a linked catalogue drink. Refresh the list.'
          using errcode='22023';
      end if;
      select h.cost_price into v_current_cost
      from public.product_cost_history h
      where h.owner_user_id=v_actor
        and h.catalogue_product_id=v_catalogue
        and h.effective_on <= v_today
        and h.business_id is not distinct from v_product.business_id
      order by h.effective_on desc,h.recorded_at desc,h.id desc
      limit 1;
      if v_current_cost is distinct from v_expected_cost then
        raise exception 'A buying cost changed elsewhere. Refresh and review again.'
          using errcode='40001';
      end if;
      if v_new_cost is distinct from v_current_cost then
        insert into public.product_cost_history(
          owner_user_id,business_id,catalogue_product_id,cost_price,effective_on,source_request_id
        ) values(v_actor,v_product.business_id,v_catalogue,v_new_cost,v_today,p_request_id);
      end if;
    end if;
    v_result := v_result || jsonb_build_array(jsonb_build_object('product_id',v_id));
    v_count := v_count + 1;
  end loop;

  v_result := jsonb_build_object('saved',true,'count',v_count,'items',v_result);
  insert into private.legacy_price_update_requests(owner_id,request_id,payload,result)
  values(v_actor,p_request_id,p_changes,v_result);
  return v_result;
end;
$bulk_prices$;

revoke all on function public.update_legacy_product_prices(uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.update_legacy_product_prices(uuid,jsonb)
  to authenticated;
commit;
