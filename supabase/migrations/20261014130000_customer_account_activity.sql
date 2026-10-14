-- Customer account overview: complete standalone empties-return history and capped-safe badges.
-- Existing store_activity owner check, event labels and page limits are preserved.
CREATE OR REPLACE FUNCTION public.store_activity(p_from date, p_to date, p_customer uuid, p_type text, p_limit integer, p_offset integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from private.shop_owner where user_id=auth.uid()) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_from is null or p_to is null or p_from>p_to or p_limit not between 1 and 100 or p_offset<0
    or p_type not in ('all','sale','payment','stock','empties','opening') then
    raise exception using errcode='22023',message='Invalid activity filters.';
  end if;
  with events as (
    select s.id,s.business_date as day,s.created_at,'sale'::text as kind,c.name as title,
      s.customer_id,s.total_amount::bigint as sale_value,s.paid_amount::bigint as received,
      'Sale · ' || c.name as description, '/sales/' || s.id as detail
    from public.sales s join public.customers c on c.id=s.customer_id where s.business_date between p_from and p_to
    union all
    select p.id,p.business_date,p.created_at,'payment',c.name,p.customer_id,0::bigint,p.amount::bigint,
      'Payment · ' || c.name,'/receipts/payment/' || p.request_id
    from public.customer_payments p join public.customers c on c.id=p.customer_id where p.business_date between p_from and p_to
    union all
    select m.id,m.business_date,m.created_at,'stock',m.product_name,null::uuid,0::bigint,0::bigint,
      case when m.movement_type='receive' then 'Received stock · ' else 'Stock count · ' end || m.product_name,
      '/activity/stock/' || m.id
    from public.stock_movements m where m.business_date between p_from and p_to
    union all
    select m.id,m.business_date,m.created_at,'empties',m.crate_type,null::uuid,0::bigint,0::bigint,
      'Empty crate count · ' || m.crate_type,'/activity/empties/' || m.id
    from public.empty_crate_movements m where m.business_date between p_from and p_to
    union all
    select s.id,s.business_date,s.created_at,'empties',c.name,s.customer_id,0::bigint,0::bigint,
      'Empties returned · ' || c.name,'/sales/' || s.id
    from public.sales s join public.customers c on c.id=s.customer_id
    where s.business_date between p_from and p_to and (
      exists(select 1 from public.sale_empty_crate_returns r where r.sale_id=s.id)
      or exists(select 1 from public.sale_empty_bottle_returns r where r.sale_id=s.id))
    union all
    -- A customer's standalone empties return (not attached to a saved sale).
    -- These are idempotently stored in private.customer_empty_returns.
    select r.request_id,
      (r.created_at at time zone 'Africa/Lagos')::date as day,
      r.created_at,
      'empties'::text as kind,
      case when totals.crates_returned=0 and totals.bottles_returned=0
        then 'Customer collected ' || totals.held_crates_released || ' held ' ||
             case when totals.held_crates_released=1 then 'crate' else 'crates' end || ', ' ||
             totals.held_bottles_released || ' held ' ||
             case when totals.held_bottles_released=1 then 'bottle' else 'bottles' end
        else 'Returned ' || totals.crates_returned || ' ' ||
             case when totals.crates_returned=1 then 'crate' else 'crates' end || ', ' ||
             totals.bottles_returned || ' ' ||
             case when totals.bottles_returned=1 then 'bottle' else 'bottles' end ||
             case when totals.held_crates_released>0 or totals.held_bottles_released>0
               then ' · Customer collected ' || totals.held_crates_released || ' held ' ||
                    case when totals.held_crates_released=1 then 'crate' else 'crates' end || ', ' ||
                    totals.held_bottles_released || ' held ' ||
                    case when totals.held_bottles_released=1 then 'bottle' else 'bottles' end
               else '' end
      end as title,
      r.customer_id,0::bigint as sale_value,0::bigint as received,
      'Empties returned · ' || c.name as description,
      '/activity?customer=' || r.customer_id || '&type=empties' as detail
    from private.customer_empty_returns r
    join public.customers c on c.id=r.customer_id
    cross join lateral (
      select
        coalesce((select sum((b.value->>'quantity')::integer) from jsonb_array_elements(coalesce(r.request_payload->'crates','[]'::jsonb)) b(value)),0)::bigint as crates_returned,
        coalesce((select sum((b.value->>'quantity')::integer) from jsonb_array_elements(coalesce(r.request_payload->'bottles','[]'::jsonb)) b(value)),0)::bigint as bottles_returned,
        -- Released IDs refer to decisions, not individual physical empties.
        -- Match the customer as well as the ID so one account never picks up another's quantities.
        held.held_crates_released, held.held_bottles_released
      from (
        select
          coalesce(sum(d.quantity) filter (where d.kind='crate'),0)::bigint as held_crates_released,
          coalesce(sum(d.quantity) filter (where d.kind='bottle'),0)::bigint as held_bottles_released
        from jsonb_array_elements_text(coalesce(r.request_payload->'released','[]'::jsonb)) released(id)
        join public.sale_empty_decisions d on d.id=released.id::uuid
          and d.customer_id=r.customer_id and d.decision='hold'
      ) held
    ) totals
    where (r.created_at at time zone 'Africa/Lagos')::date between p_from and p_to

    union all
    -- Customer collected wrong empties directly from the account, not via return form.
    select h.decision_id,(h.collected_at at time zone 'Africa/Lagos')::date,
      h.collected_at,'empties',
      'Customer collected ' || d.quantity || ' held ' ||
        case when d.kind='crate' then case when d.quantity=1 then 'crate' else 'crates' end
          else case when d.quantity=1 then 'bottle' else 'bottles' end end,
      h.customer_id,0::bigint,0::bigint,
      'Held empties collected · ' || c.name,
      '/sales/' || d.sale_id
    from private.held_empty_collections h
    join public.sale_empty_decisions d on d.id=h.decision_id and d.customer_id=h.customer_id
    join public.customers c on c.id=h.customer_id
    where (h.collected_at at time zone 'Africa/Lagos')::date between p_from and p_to
    union all
    select o.id,o.business_date,o.created_at,'opening',c.name,o.customer_id,0::bigint,0::bigint,
      'Opening balances · ' || c.name,'/customers/' || o.customer_id || '/opening-balances'
    from public.customer_opening_balances o join public.customers c on c.id=o.customer_id
    where o.business_date between p_from and p_to
  ), filtered as (
    select * from events where (p_customer is null or customer_id=p_customer)
      and (p_type='all' or kind=p_type)
  )
  select jsonb_build_object(
    'count',(select count(*) from filtered),
    'sales_value',(select coalesce(sum(sale_value),0) from filtered),
    'received',(select coalesce(sum(received),0) from filtered),
    'items',(select coalesce(jsonb_agg(to_jsonb(page)), '[]'::jsonb) from (
      select id,day,created_at,kind,title,description,detail,sale_value,received
      from filtered order by day desc,created_at desc,kind,id desc limit p_limit offset p_offset
    ) page)
  ) into v_result;
  return v_result;
end $function$;



-- Direct "Customer collected these empties" actions must be visible in history.
-- The return form writes its own private.customer_empty_returns receipt, so it
-- never inserts into this table: the same physical collection is shown once.
create table private.held_empty_collections (
  decision_id uuid primary key references public.sale_empty_decisions(id),
  customer_id uuid not null references public.customers(id),
  collected_at timestamptz not null
);
create index held_empty_collections_recent_idx
  on private.held_empty_collections(customer_id,collected_at desc,decision_id desc);

-- Restore historical inline collections; exclude those already accounted for by
-- a standalone return-form receipt (including mixed correct/held collections).
insert into private.held_empty_collections(decision_id,customer_id,collected_at)
select d.id,d.customer_id,d.released_at
from public.sale_empty_decisions d
where d.decision='hold' and d.released_at is not null
  and not exists (
    select 1 from private.customer_empty_returns r
    where r.customer_id=d.customer_id
      and coalesce(r.request_payload->'released','[]'::jsonb) @> jsonb_build_array(d.id::text)
  );

-- Keep the established public RPC and its idempotent semantics. Only newly
-- updated decisions become events, and both changes commit or roll back together.
create or replace function private.release_held_empties(p_id uuid)
returns void language plpgsql security definer set search_path='' as $release$
declare v_decision record;
begin
  if auth.uid() is null or not exists (
    select 1 from private.shop_owner where user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  update public.sale_empty_decisions
    set released_at=now()
    where id=p_id and decision='hold' and released_at is null
    returning id,customer_id,released_at into v_decision;
  if found then
    insert into private.held_empty_collections(decision_id,customer_id,collected_at)
    values (v_decision.id,v_decision.customer_id,v_decision.released_at);
  end if;
end
$release$;

-- Fast, owner-only customer-account feed. Each source retrieves at most six
-- recent rows before its events are combined. The complete Activity screen
-- continues to use store_activity with full counts and totals.
create or replace function public.customer_recent_activity(p_customer uuid)
returns jsonb language plpgsql security definer set search_path='' as $recent$
declare v_result jsonb;
declare v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  if auth.uid() is null or not exists (
    select 1 from private.shop_owner where user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_customer is null then
    raise exception using errcode='22023',message='Choose a customer.';
  end if;
  with recent_sales as materialized (
    select s.id,s.customer_id,s.business_date,s.created_at,s.total_amount,s.paid_amount
    from public.sales s
    where s.customer_id=p_customer and s.business_date<=v_today
    order by s.business_date desc,s.created_at desc,s.id desc limit 6
  ), recent_payments as materialized (
    select p.id,p.request_id,p.customer_id,p.business_date,p.created_at,p.amount
    from public.customer_payments p
    where p.customer_id=p_customer and p.business_date<=v_today
    order by p.business_date desc,p.created_at desc,p.id desc limit 6
  ), recent_returns as materialized (
    select r.request_id,r.customer_id,r.created_at,r.request_payload
    from private.customer_empty_returns r
    where r.customer_id=p_customer and r.created_at < ((v_today+1)::timestamp at time zone 'Africa/Lagos')
    order by r.created_at desc,r.request_id desc limit 6
  ), recent_collections as materialized (
    select h.decision_id,h.customer_id,h.collected_at
    from private.held_empty_collections h
    where h.customer_id=p_customer and h.collected_at < ((v_today+1)::timestamp at time zone 'Africa/Lagos')
    order by h.collected_at desc,h.decision_id desc limit 6
  ), recent_openings as materialized (
    select o.id,o.customer_id,o.business_date,o.created_at
    from public.customer_opening_balances o
    where o.customer_id=p_customer and o.business_date<=v_today
    order by o.business_date desc,o.created_at desc,o.id desc limit 6
  ), events as (
    select s.id,s.business_date as day,s.created_at,'sale'::text as kind,
      c.name as title,'Sale · ' || c.name as description,
      '/sales/' || s.id as detail,
      s.total_amount::bigint as sale_value,s.paid_amount::bigint as received
    from recent_sales s join public.customers c on c.id=s.customer_id
    union all
    select p.id,p.business_date,p.created_at,'payment',c.name,
      'Payment · ' || c.name,'/receipts/payment/' || p.request_id,
      0::bigint,p.amount::bigint
    from recent_payments p join public.customers c on c.id=p.customer_id
    union all
    select s.id,s.business_date,s.created_at,'empties',c.name,
      'Empties returned · ' || c.name,'/sales/' || s.id,0::bigint,0::bigint
    from recent_sales s join public.customers c on c.id=s.customer_id
    where exists(select 1 from public.sale_empty_crate_returns r where r.sale_id=s.id)
       or exists(select 1 from public.sale_empty_bottle_returns r where r.sale_id=s.id)
    union all
    select r.request_id,(r.created_at at time zone 'Africa/Lagos')::date,
      r.created_at,'empties',case
        when totals.crates_returned=0 and totals.bottles_returned=0
        then 'Customer collected ' || totals.held_crates || ' held ' ||
          case when totals.held_crates=1 then 'crate' else 'crates' end || ', ' ||
          totals.held_bottles || ' held ' ||
          case when totals.held_bottles=1 then 'bottle' else 'bottles' end
        else 'Returned ' || totals.crates_returned || ' ' ||
          case when totals.crates_returned=1 then 'crate' else 'crates' end || ', ' ||
          totals.bottles_returned || ' ' ||
          case when totals.bottles_returned=1 then 'bottle' else 'bottles' end ||
          case when totals.held_crates>0 or totals.held_bottles>0
            then ' · Customer collected ' || totals.held_crates || ' held ' ||
              case when totals.held_crates=1 then 'crate' else 'crates' end || ', ' ||
              totals.held_bottles || ' held ' ||
              case when totals.held_bottles=1 then 'bottle' else 'bottles' end
            else '' end
      end,
      'Empties returned · ' || c.name,
      '/activity?customer=' || r.customer_id || '&type=empties',
      0::bigint,0::bigint
    from recent_returns r join public.customers c on c.id=r.customer_id
    cross join lateral (
      select
        coalesce((select sum((x.value->>'quantity')::integer)
          from jsonb_array_elements(coalesce(r.request_payload->'crates','[]'::jsonb)) x(value)),0)::bigint as crates_returned,
        coalesce((select sum((x.value->>'quantity')::integer)
          from jsonb_array_elements(coalesce(r.request_payload->'bottles','[]'::jsonb)) x(value)),0)::bigint as bottles_returned,
        coalesce((select sum(d.quantity) from
          jsonb_array_elements_text(coalesce(r.request_payload->'released','[]'::jsonb)) e(id)
          join public.sale_empty_decisions d on d.id=e.id::uuid and d.customer_id=r.customer_id
          where d.kind='crate' and d.decision='hold'),0)::bigint as held_crates,
        coalesce((select sum(d.quantity) from
          jsonb_array_elements_text(coalesce(r.request_payload->'released','[]'::jsonb)) e(id)
          join public.sale_empty_decisions d on d.id=e.id::uuid and d.customer_id=r.customer_id
          where d.kind='bottle' and d.decision='hold'),0)::bigint as held_bottles
    ) totals
    union all
    select h.decision_id,(h.collected_at at time zone 'Africa/Lagos')::date,
      h.collected_at,'empties',
      'Customer collected ' || d.quantity || ' held ' ||
        case when d.kind='crate' then case when d.quantity=1 then 'crate' else 'crates' end
             else case when d.quantity=1 then 'bottle' else 'bottles' end end,
      'Held empties collected · ' || c.name,
      '/sales/' || d.sale_id,0::bigint,0::bigint
    from recent_collections h
    join public.sale_empty_decisions d on d.id=h.decision_id and d.customer_id=h.customer_id
    join public.customers c on c.id=h.customer_id
    union all
    select o.id,o.business_date,o.created_at,'opening',c.name,
      'Opening balances · ' || c.name,
      '/customers/' || o.customer_id || '/opening-balances',
      0::bigint,0::bigint
    from recent_openings o join public.customers c on c.id=o.customer_id
  )
  select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb))
    into v_result
  from (
    select id,day,created_at,kind,title,description,detail,sale_value,received
    from events order by day desc,created_at desc,kind,id desc limit 6
  ) e;
  return v_result;
end
$recent$;

revoke all on function public.customer_recent_activity(uuid) from public,anon;
grant execute on function public.customer_recent_activity(uuid) to authenticated;

create index if not exists sales_recent_customer_idx
  on public.sales(customer_id,business_date desc,created_at desc,id desc);
create index if not exists payments_recent_customer_idx
  on public.customer_payments(customer_id,business_date desc,created_at desc,id desc);
create index if not exists returns_recent_customer_idx
  on private.customer_empty_returns(customer_id,created_at desc,request_id desc);

-- Open wrong-empties can grow indefinitely: support the visible-customer grouped count.
create index if not exists sale_empty_decisions_open_held_customer_idx
  on public.sale_empty_decisions(customer_id)
  where decision='hold' and released_at is null;

-- Compute the customer-list badges from aggregates, never from a capped page of rows.
-- Owner-only and bounded to the 30 visible customers.
create or replace function public.customer_account_snapshot(p_customer_ids uuid[])
returns table(customer_id uuid, crates_owed bigint, bottles_owed bigint, held_entries bigint)
language plpgsql security definer set search_path to ''
as $account$
begin
  if auth.uid() is null or not exists (
    select 1 from private.shop_owner where user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_customer_ids is null or cardinality(p_customer_ids)>30 then
    raise exception using errcode='22023',message='Too many customers requested.';
  end if;
  return query
    select c.id,
      coalesce((select sum(o.quantity)::bigint from public.crate_obligations o
                where o.customer_id=c.id and o.quantity>0),0) as crates_owed,
      coalesce((select sum(o.quantity)::bigint from public.bottle_obligations o
                where o.customer_id=c.id and o.quantity>0),0) as bottles_owed,
      coalesce(h.held_entries,0)::bigint as held_entries
    from public.customers c
    left join (
      -- One grouped, indexed lookup for only the visible customers.
      select s.customer_id, count(*)::bigint as held_entries
      from public.sale_empty_decisions s
      where s.customer_id=any(p_customer_ids)
        and s.decision='hold' and s.released_at is null
      group by s.customer_id
    ) h on h.customer_id=c.id
    where c.id=any(p_customer_ids) and c.archived_at is null;
end
$account$;

revoke all on function public.customer_account_snapshot(uuid[]) from public;
grant execute on function public.customer_account_snapshot(uuid[]) to authenticated;
