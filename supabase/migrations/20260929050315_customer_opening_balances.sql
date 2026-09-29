begin;

-- Pre-system debt, recorded once per customer. This is not a sale or payment.
create table public.customer_opening_balances (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.customers(id),
  request_id uuid not null unique,
  amount integer not null check (amount >= 0),
  business_date date not null check (business_date between date '0001-01-01' and date '9999-12-31'),
  note text not null default '' check (length(note)<=300),
  crates jsonb not null check (jsonb_typeof(crates)='array'),
  bottles jsonb not null check (jsonb_typeof(bottles)='array'),
  request_payload jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.customer_opening_balances enable row level security;
revoke all on public.customer_opening_balances from public,anon,authenticated;
grant select on public.customer_opening_balances to authenticated;
create policy owner_read on public.customer_opening_balances for select to authenticated
using ((select public.is_shop_owner()));

create function private.record_opening_balances(
  p_request_id uuid,p_customer_id uuid,p_amount numeric,p_business_date date,
  p_note text,p_crates jsonb,p_bottles jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_existing public.customer_opening_balances%rowtype;
  v_customer public.customers%rowtype;
  v_crate public.crate_types%rowtype;
  v_row jsonb;
  v_payload jsonb;
  v_crates jsonb := '[]'::jsonb;
  v_bottles jsonb := '[]'::jsonb;
  v_quantity integer;
  v_id uuid;
begin
  if auth.uid() is null or not exists(select 1 from private.shop_owner where user_id=auth.uid()) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_request_id is null or p_customer_id is null or p_amount is null or p_amount='NaN'::numeric
    or p_amount<0 or p_amount>2147483647 or p_amount<>trunc(p_amount)
    or p_business_date is null or p_business_date not between date '0001-01-01' and date '9999-12-31'
    or p_business_date>(now() at time zone 'Africa/Lagos')::date
    or p_note is null or length(p_note)>300
    or jsonb_typeof(p_crates) is distinct from 'array' or jsonb_typeof(p_bottles) is distinct from 'array' then
    raise exception using errcode='22023',message='opening_invalid';
  end if;
  if jsonb_array_length(p_crates)>100 or jsonb_array_length(p_bottles)>100
    or (p_amount=0 and jsonb_array_length(p_crates)=0 and jsonb_array_length(p_bottles)=0) then
    raise exception using errcode='22023',message='opening_invalid';
  end if;
  v_payload := jsonb_build_object('customer',p_customer_id,'amount',p_amount,'date',p_business_date,'note',btrim(p_note),'crates',p_crates,'bottles',p_bottles);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  select * into v_existing from public.customer_opening_balances where request_id=p_request_id;
  if found then
    if v_existing.request_payload is distinct from v_payload then
      raise exception using errcode='22023',message='opening_request_changed';
    end if;
    return v_existing.id;
  end if;
  -- Serialize different opening forms for this customer. Never replace current debt.
  select * into v_customer from public.customers where id=p_customer_id for update;
  if not found or v_customer.archived_at is not null then
    raise exception using errcode='22023',message='opening_customer_unavailable';
  end if;
  if exists(select 1 from public.customer_opening_balances where customer_id=p_customer_id) then
    raise exception using errcode='22023',message='opening_already_recorded';
  end if;
  if exists(select 1 from jsonb_array_elements(p_crates) x group by x->>'type' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(p_bottles) x group by x->>'type' having count(*)>1) then
    raise exception using errcode='22023',message='opening_invalid';
  end if;
  for v_row in select value from jsonb_array_elements(p_crates || p_bottles) loop
    if jsonb_typeof(v_row) is distinct from 'object'
      or coalesce(v_row->>'type','')='' or length(v_row->>'type')>160
      or coalesce(v_row->>'quantity','') !~ '^[0-9]+$' then
      raise exception using errcode='22023',message='opening_invalid';
    end if;
    if (v_row->>'quantity')::numeric not between 1 and 2147483647 then
      raise exception using errcode='22023',message='opening_invalid';
    end if;
  end loop;
  -- All writes below are one transaction; any failure rolls them all back.
  insert into public.money_owed(customer_id,amount) values(p_customer_id,p_amount::integer)
    on conflict(customer_id) do update set amount=public.money_owed.amount+excluded.amount;
  for v_row in select value from jsonb_array_elements(p_crates) order by value->>'type' loop
    if (v_row->>'type') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception using errcode='22023',message='opening_invalid';
    end if;
    select * into v_crate from public.crate_types where id=(v_row->>'type')::uuid for key share;
    if not found or v_crate.is_legacy or v_crate.pocket_count is null or v_crate.empty_family is null then
      raise exception using errcode='22023',message='opening_crate_unavailable';
    end if;
    v_quantity := (v_row->>'quantity')::integer;
    insert into public.crate_obligations(customer_id,crate_type_id,crate_type,quantity)
      values(p_customer_id,v_crate.id,v_crate.name,v_quantity)
      on conflict(customer_id,crate_type_id) do update set quantity=public.crate_obligations.quantity+excluded.quantity;
    v_crates := v_crates || jsonb_build_array(jsonb_build_object('type',v_crate.id,'name',v_crate.name,'quantity',v_quantity));
  end loop;
  for v_row in select value from jsonb_array_elements(p_bottles) order by value->>'type' loop
    if not exists(select 1 from public.products where bottles_returnable and bottle_type=v_row->>'type')
      and not exists(select 1 from public.bottle_obligations where bottle_type=v_row->>'type') then
      raise exception using errcode='22023',message='opening_bottle_unavailable';
    end if;
    v_quantity := (v_row->>'quantity')::integer;
    insert into public.bottle_obligations(customer_id,bottle_type,quantity) values(p_customer_id,v_row->>'type',v_quantity)
      on conflict(customer_id,bottle_type) do update set quantity=public.bottle_obligations.quantity+excluded.quantity;
    v_bottles := v_bottles || jsonb_build_array(jsonb_build_object('type',v_row->>'type','name',v_row->>'type','quantity',v_quantity));
  end loop;
  insert into public.customer_opening_balances(customer_id,request_id,amount,business_date,note,crates,bottles,request_payload)
    values(p_customer_id,p_request_id,p_amount::integer,p_business_date,btrim(p_note),v_crates,v_bottles,v_payload) returning id into v_id;
  return v_id;
end $$;
revoke all on function private.record_opening_balances(uuid,uuid,numeric,date,text,jsonb,jsonb) from public,anon,authenticated;
create function public.record_opening_balances(p_request_id uuid,p_customer_id uuid,p_amount numeric,p_business_date date,p_note text,p_crates jsonb,p_bottles jsonb)
returns uuid language sql security definer set search_path='' as $$
  select private.record_opening_balances(p_request_id,p_customer_id,p_amount,p_business_date,p_note,p_crates,p_bottles);
$$;
revoke all on function public.record_opening_balances(uuid,uuid,numeric,date,text,jsonb,jsonb) from public,anon;
grant execute on function public.record_opening_balances(uuid,uuid,numeric,date,text,jsonb,jsonb) to authenticated;

create or replace function public.store_activity(p_from date,p_to date,p_customer uuid,p_type text,p_limit integer,p_offset integer)
returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function public.store_activity(date,date,uuid,text,integer,integer) from public,anon;
grant execute on function public.store_activity(date,date,uuid,text,integer,integer) to authenticated;
commit;
