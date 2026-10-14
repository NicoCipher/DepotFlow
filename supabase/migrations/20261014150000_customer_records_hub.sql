begin;

-- Customer-facing records live separately from operational stock activity.
-- Reads only existing ledgers; never creates a second sale or payment.
create or replace function public.customer_records(
  p_from date,
  p_to date,
  p_kind text,
  p_method text,
  p_search text,
  p_limit integer,
  p_offset integer
) returns jsonb
language plpgsql security definer set search_path='' as $records$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from private.shop_owner where user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_from is null or p_to is null or p_from>p_to
    or p_kind is null or p_kind not in ('all','sale','payment','empties','opening')
    or p_method is null or p_method not in ('all','cash','transfer','pos','not_recorded')
    or p_search is null or length(p_search)>120
    or p_limit not between 1 and 50 or p_offset not between 0 and 1000000 then
    raise exception using errcode='22023',message='Check record filters.';
  end if;

  with events as (
    select s.id,s.business_date as day,s.created_at,
      'sale'::text as kind,s.customer_id,
      coalesce(nullif(s.receipt_customer_name,''),c.name)::text as customer_name,
      c.business_name::text as business_name,c.phone::text as phone,
      s.receipt_number::text as receipt_number,
      s.payment_method::text as method,
      s.total_amount::bigint as sale_total,
      s.paid_amount::bigint as received,
      (s.total_amount-s.paid_amount)::bigint as remaining,
      0::bigint as crates,0::bigint as bottles,
      0::bigint as held_crates,0::bigint as held_bottles,
      case when s.receipt_status='voided' then 'voided'
        when s.paid_amount=0 then 'unpaid'
        when s.paid_amount<s.total_amount then 'partial'
        else 'paid' end::text as status,
      ('/receipts/sale/' || s.id)::text as detail
    from public.sales s join public.customers c on c.id=s.customer_id
    where s.business_date between p_from and p_to

    union all

    select p.id,p.business_date,p.created_at,
      'payment',p.customer_id,
      coalesce(nullif(p.receipt_customer_name,''),c.name),
      c.business_name,c.phone,p.receipt_number,p.method,
      0::bigint,p.amount::bigint,p.owed_after::bigint,
      0::bigint,0::bigint,0::bigint,0::bigint,
      case when p.receipt_status='voided' then 'voided' else 'received' end,
      '/receipts/payment/' || p.id
    from public.customer_payments p join public.customers c on c.id=p.customer_id
    where p.business_date between p_from and p_to

    union all

    -- Standalone physical returns are not cash receipts. Sale-time empties
    -- are part of their sale record and must not create another sale.
    select r.request_id,(r.created_at at time zone 'Africa/Lagos')::date,
      r.created_at,'empties',r.customer_id,c.name,c.business_name,c.phone,
      null::text,null::text,0::bigint,0::bigint,0::bigint,
      coalesce((select sum((x.value->>'quantity')::bigint)
        from jsonb_array_elements(coalesce(r.request_payload->'crates','[]'::jsonb)) x(value)),0),
      coalesce((select sum((x.value->>'quantity')::bigint)
        from jsonb_array_elements(coalesce(r.request_payload->'bottles','[]'::jsonb)) x(value)),0),
      held.crates,held.bottles,'recorded',
      '/records/empties/' || r.request_id
    from private.customer_empty_returns r join public.customers c on c.id=r.customer_id
    cross join lateral (
      select
        coalesce(sum(d.quantity) filter (where d.kind='crate'),0)::bigint as crates,
        coalesce(sum(d.quantity) filter (where d.kind='bottle'),0)::bigint as bottles
      from jsonb_array_elements_text(coalesce(r.request_payload->'released','[]'::jsonb)) e(id)
      join public.sale_empty_decisions d on d.id=e.id::uuid and d.customer_id=r.customer_id
    ) held
    where r.created_at >= (p_from::timestamp at time zone 'Africa/Lagos')
      and r.created_at < ((p_to+1)::timestamp at time zone 'Africa/Lagos')

    union all

    select o.id,o.business_date,o.created_at,'opening',
      o.customer_id,c.name,c.business_name,c.phone,
      null::text,null::text,0::bigint,0::bigint,o.amount::bigint,
      coalesce((select sum((x.value->>'quantity')::bigint)
        from jsonb_array_elements(o.crates) x(value)),0),
      coalesce((select sum((x.value->>'quantity')::bigint)
        from jsonb_array_elements(o.bottles) x(value)),0),
      0::bigint,0::bigint,'recorded',
      '/customers/' || o.customer_id || '/opening-balances'
    from public.customer_opening_balances o
    join public.customers c on c.id=o.customer_id
    where o.business_date between p_from and p_to
  ), filtered as (
    select * from events e
    where (p_kind='all' or e.kind=p_kind)
      and (p_method='all' or e.method=p_method)
      and (btrim(p_search)='' or
        e.customer_name ilike '%'||btrim(p_search)||'%' or
        coalesce(e.business_name,'') ilike '%'||btrim(p_search)||'%' or
        coalesce(e.phone,'') ilike '%'||btrim(p_search)||'%' or
        coalesce(e.receipt_number,'') ilike '%'||btrim(p_search)||'%')
  )
  select jsonb_build_object(
    'count',(select count(*) from filtered),
    'items',(select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb)
      from (
        select id,day,created_at,kind,customer_id,customer_name,business_name,
          receipt_number,method,sale_total,received,remaining,crates,bottles,
          held_crates,held_bottles,status,detail
        from filtered
        order by day desc,created_at desc,kind,id desc
        limit p_limit offset p_offset
      ) t)
  ) into v_result;
  return v_result;
end $records$;

revoke all on function public.customer_records(date,date,text,text,text,integer,integer) from public,anon;
grant execute on function public.customer_records(date,date,text,text,text,integer,integer) to authenticated;

-- Dedicated read-only source for an empties return: never substitute current
-- customer balances or invent a payment method.
create or replace function public.customer_return_record(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $return$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(
    select 1 from private.shop_owner where user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  select jsonb_build_object(
    'id',r.request_id,'customer_id',r.customer_id,
    'customer_name',c.name,'business_name',c.business_name,'created_at',r.created_at,
    'crates',coalesce((select jsonb_agg(jsonb_build_object(
      'name',coalesce(ct.name,'Crate'),'quantity',(x.value->>'quantity')::integer))
      from jsonb_array_elements(coalesce(r.request_payload->'crates','[]'::jsonb)) x(value)
      left join public.crate_types ct on ct.id=(x.value->>'crateTypeId')::uuid),'[]'::jsonb),
    'bottles',coalesce((select jsonb_agg(jsonb_build_object(
      'name',x.value->>'bottleType','quantity',(x.value->>'quantity')::integer))
      from jsonb_array_elements(coalesce(r.request_payload->'bottles','[]'::jsonb)) x(value)),'[]'::jsonb),
    'released',coalesce((select jsonb_agg(jsonb_build_object(
      'name',d.returned_name,'kind',d.kind,'quantity',d.quantity))
      from jsonb_array_elements_text(coalesce(r.request_payload->'released','[]'::jsonb)) e(id)
      join public.sale_empty_decisions d on d.id=e.id::uuid and d.customer_id=r.customer_id),'[]'::jsonb)
  ) into v_result
  from private.customer_empty_returns r join public.customers c on c.id=r.customer_id
  where r.request_id=p_id;
  return v_result;
end $return$;

revoke all on function public.customer_return_record(uuid) from public,anon;
grant execute on function public.customer_return_record(uuid) to authenticated;

create index if not exists customer_empty_returns_recent_idx
  on private.customer_empty_returns(created_at desc,request_id desc);
create index if not exists sales_records_recent_idx
  on public.sales(business_date desc,created_at desc,id desc);
create index if not exists payments_records_recent_idx
  on public.customer_payments(business_date desc,created_at desc,id desc);

commit;
