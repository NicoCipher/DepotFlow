-- Allow a cost value to recur later in the same business day without rewriting history.
-- Each event is tied to the RPC's idempotency request; the request table still rejects
-- replay with a different payload, and product row locks serialize competing updates.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table public.product_cost_history add column if not exists source_request_id uuid;

-- The two historical cost-value indexes are partial indexes. Verify their
-- exact definitions, then remove only those two indexes. Do not match by
-- column set alone: unrelated unique indexes must remain untouched.
do $replace_cost_value_uniqueness$
declare
  v_business_index oid;
  v_legacy_index oid;
  v_keys text[];
  v_predicate text;
begin
  select i.indexrelid into v_business_index
  from pg_catalog.pg_index i
  join pg_catalog.pg_class idx on idx.oid=i.indexrelid
  where i.indrelid='public.product_cost_history'::regclass
    and idx.relname='business_cost_history_unique'
    and i.indisunique and not i.indisprimary;
  select i.indexrelid into v_legacy_index
  from pg_catalog.pg_index i
  join pg_catalog.pg_class idx on idx.oid=i.indexrelid
  where i.indrelid='public.product_cost_history'::regclass
    and idx.relname='prebackfill_owner_cost_history_unique'
    and i.indisunique and not i.indisprimary;

  if v_business_index is null or v_legacy_index is null then
    raise exception 'Expected both historical partial cost indexes; refusing ambiguous cleanup';
  end if;

  select array_agg(a.attname::text order by k.ordinality)
    into v_keys
  from pg_catalog.pg_index i
  cross join lateral unnest(i.indkey) with ordinality as k(attnum,ordinality)
  join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
  where i.indexrelid=v_business_index and k.ordinality<=i.indnkeyatts;
  select pg_catalog.pg_get_expr(i.indpred,i.indrelid)
    into v_predicate from pg_catalog.pg_index i
    where i.indexrelid=v_business_index;
  if v_keys is distinct from array['business_id','catalogue_product_id','effective_on','cost_price']::text[]
     or v_predicate is distinct from '(business_id IS NOT NULL)' then
    raise exception 'business_cost_history_unique definition drift: keys %, predicate %',v_keys,v_predicate;
  end if;

  select array_agg(a.attname::text order by k.ordinality)
    into v_keys
  from pg_catalog.pg_index i
  cross join lateral unnest(i.indkey) with ordinality as k(attnum,ordinality)
  join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum
  where i.indexrelid=v_legacy_index and k.ordinality<=i.indnkeyatts;
  select pg_catalog.pg_get_expr(i.indpred,i.indrelid)
    into v_predicate from pg_catalog.pg_index i
    where i.indexrelid=v_legacy_index;
  if v_keys is distinct from array['owner_user_id','catalogue_product_id','effective_on','cost_price']::text[]
     or v_predicate is distinct from '(business_id IS NULL)' then
    raise exception 'prebackfill_owner_cost_history_unique definition drift: keys %, predicate %',v_keys,v_predicate;
  end if;

  drop index public.business_cost_history_unique;
  drop index public.prebackfill_owner_cost_history_unique;
end;
$replace_cost_value_uniqueness$;

-- Request IDs make each append-only event unique in both business-scoped
-- and legacy NULL-business rows. Separate partial indexes are required:
-- ordinary UNIQUE treats NULL business_id values as distinct.
create unique index product_cost_history_business_request_uidx
  on public.product_cost_history(owner_user_id,business_id,catalogue_product_id,source_request_id)
  where business_id is not null and source_request_id is not null;
create unique index product_cost_history_legacy_request_uidx
  on public.product_cost_history(owner_user_id,catalogue_product_id,source_request_id)
  where business_id is null and source_request_id is not null;

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
          owner_user_id,business_id,catalogue_product_id,cost_price,effective_on,recorded_at,source_request_id
        ) values(v_actor,v_product.business_id,v_catalogue,v_new_cost,v_today,clock_timestamp(),p_request_id);
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
-- Preserve the tenant quote API's duplicate-quote rule after replacing the
-- old cost-value unique indexes. The bulk editor may record a same-day
-- reversion as a distinct request event; this separate RPC must still reject
-- an identical business/catalogue/date/cost quote. Serialize that check so
-- two different request IDs cannot race past it.
create or replace function public.record_business_buying_cost(
  p_business_id uuid, p_event_id uuid, p_catalogue_product_id uuid,
  p_cost_price integer, p_effective_on date
) returns jsonb
language plpgsql security definer set search_path=''
as $record_cost$
declare
  v_actor uuid:=auth.uid();
  v_event private.business_cost_history_requests%rowtype;
  v_written uuid;
begin
  if v_actor is null or p_business_id is null then
    raise exception 'Verified business owner session required' using errcode='42501';
  end if;
  perform 1 from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    where m.business_id=p_business_id and m.user_id=v_actor
      and m.member_kind='owner' and m.status='active'
      and b.status in ('setup','active') and b.legacy_singleton is null
    for share of m,b;
  if not found then
    raise exception 'Business not available' using errcode='42501';
  end if;
  perform 1 from private.business_cost_history_gate where enabled is true for share;
  if not found or not exists(
    select 1 from private.legacy_write_scope_gate where enabled is true
  ) then
    raise exception 'Business buying-cost history is not available' using errcode='42501';
  end if;
  if p_event_id is null or p_catalogue_product_id is null
     or p_cost_price is null or p_cost_price<0 or p_effective_on is null then
    raise exception 'Choose a drink, buying cost and valid effective date' using errcode='22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_business_id::text||':'||p_event_id::text,0)
  );
  select * into v_event from private.business_cost_history_requests
    where request_id=p_event_id and business_id=p_business_id for update;
  if found then
    if v_event.catalogue_product_id is distinct from p_catalogue_product_id
       or v_event.cost_price is distinct from p_cost_price
       or v_event.effective_on is distinct from p_effective_on
       or v_event.actor_id is distinct from v_actor then
      raise exception 'This buying-cost request was already used' using errcode='22023';
    end if;
    return jsonb_build_object(
      'requestId',p_event_id,'eventId',v_event.history_id,
      'businessId',p_business_id,'catalogueProductId',v_event.catalogue_product_id,
      'costPrice',v_event.cost_price,'effectiveOn',v_event.effective_on
    );
  end if;

  if not exists(select 1 from public.product_catalogue where id=p_catalogue_product_id) then
    raise exception 'Master catalogue drink not found' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'business-cost-quote:'||p_business_id::text||':'||p_catalogue_product_id::text||':'||
    p_effective_on::text||':'||p_cost_price::text,0));
  if exists(select 1 from public.product_cost_history h
    where h.owner_user_id=v_actor and h.business_id=p_business_id
      and h.catalogue_product_id=p_catalogue_product_id
      and h.effective_on=p_effective_on and h.cost_price=p_cost_price) then
    raise exception 'Identical business buying-cost quote already recorded' using errcode='22023';
  end if;

  insert into public.product_cost_history(
    owner_user_id,business_id,catalogue_product_id,cost_price,effective_on
  ) values(v_actor,p_business_id,p_catalogue_product_id,p_cost_price,p_effective_on)
  returning id into v_written;
  insert into private.business_cost_history_requests(
    business_id,request_id,actor_id,catalogue_product_id,cost_price,effective_on,history_id
  ) values(p_business_id,p_event_id,v_actor,p_catalogue_product_id,p_cost_price,p_effective_on,v_written);
  return jsonb_build_object(
    'requestId',p_event_id,'eventId',v_written,'businessId',p_business_id,
    'catalogueProductId',p_catalogue_product_id,'costPrice',p_cost_price,'effectiveOn',p_effective_on
  );
end;
$record_cost$;
revoke all on function public.record_business_buying_cost(uuid,uuid,uuid,integer,date)
  from public,anon,authenticated,service_role;

commit;
