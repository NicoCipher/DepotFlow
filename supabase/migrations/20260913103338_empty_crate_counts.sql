begin;

-- Known exact types include recorded stock even if products later change type.
-- Invoker security preserves owner RLS on both underlying tables.
create view public.known_empty_crates with (security_invoker = true) as
select types.crate_type, stock.quantity
from (
  select crate_type from public.products
  union
  select crate_type from public.empty_crate_stock
) types
left join public.empty_crate_stock stock using (crate_type);
revoke all on public.known_empty_crates from public,anon,authenticated;
grant select on public.known_empty_crates to authenticated;

create table public.empty_crate_movements (
  id uuid primary key default gen_random_uuid(),
  crate_type text not null references public.empty_crate_stock(crate_type),
  -- Extend this constraint when another movement is implemented.
  movement_type text not null check (movement_type = 'count'),
  previous_quantity integer check (previous_quantity >= 0),
  quantity_change integer not null,
  resulting_quantity integer not null check (resulting_quantity >= 0),
  business_date date not null check (business_date between date '0001-01-01' and date '9999-12-31'),
  created_at timestamptz not null default now(),
  request_id uuid not null unique,
  check (quantity_change = resulting_quantity - coalesce(previous_quantity,0))
);
create index empty_crate_movements_recent_idx on public.empty_crate_movements(created_at desc,id desc);
create index empty_crate_movements_type_idx on public.empty_crate_movements(crate_type);
alter table public.empty_crate_movements enable row level security;
revoke all on public.empty_crate_movements from public,anon,authenticated;
grant select on public.empty_crate_movements to authenticated;
create policy owner_read on public.empty_crate_movements for select to authenticated
using (exists(select 1 from private.shop_owner where user_id=(select auth.uid())));

create function private.set_empty_crate_count(
  p_request_id uuid, p_crate_type text, p_quantity numeric,
  p_business_date date, p_expected_quantity integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_movement public.empty_crate_movements%rowtype;
  v_inserted boolean;
  v_quantity integer;
  v_previous integer;
begin
  if auth.uid() is null or not exists(select 1 from private.shop_owner where user_id=auth.uid()) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_request_id is null or p_crate_type is null or btrim(p_crate_type) = '' then
    raise exception using errcode='22023',message='Choose an existing crate type.';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 2147483647
    or p_quantity <> trunc(p_quantity) or p_quantity = 'NaN'::numeric then
    raise exception using errcode='22023',message='Enter a whole number of crates, zero or more.';
  end if;
  if p_business_date is null or p_business_date not between date '0001-01-01' and date '9999-12-31' then
    raise exception using errcode='22023',message='Choose a valid business date.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text,0));
  select * into v_movement from public.empty_crate_movements where request_id=p_request_id;
  if found then
    if v_movement.crate_type <> p_crate_type or v_movement.movement_type <> 'count'
      or v_movement.resulting_quantity <> p_quantity or v_movement.business_date <> p_business_date then
      raise exception using errcode='22023',message='This count form has already been used.';
    end if;
    return jsonb_build_object('quantity_after',v_movement.resulting_quantity);
  end if;
  if not exists(select 1 from public.products where crate_type=p_crate_type)
    and not exists(select 1 from public.empty_crate_stock where crate_type=p_crate_type) then
    raise exception using errcode='22023',message='Choose an existing crate type.';
  end if;
  -- The unique crate type serializes competing first counts. Existing rows use
  -- the same row lock as receive_stock; neither operation can lose an update.
  insert into public.empty_crate_stock(crate_type,quantity) values(p_crate_type,0)
    on conflict do nothing returning true into v_inserted;
  select quantity into v_quantity from public.empty_crate_stock where crate_type=p_crate_type for update;
  v_previous := case when v_inserted then null else v_quantity end;
  if p_expected_quantity is distinct from v_previous then
    raise exception using errcode='22023',message='Empty crates changed. Review the count again.';
  end if;
  update public.empty_crate_stock set quantity=p_quantity::integer where crate_type=p_crate_type;
  insert into public.empty_crate_movements(crate_type,movement_type,previous_quantity,quantity_change,resulting_quantity,business_date,request_id)
    values(p_crate_type,'count',v_previous,p_quantity::integer-coalesce(v_previous,0),p_quantity::integer,p_business_date,p_request_id);
  return jsonb_build_object('quantity_after',p_quantity::integer);
end $$;
revoke all on function private.set_empty_crate_count(uuid,text,numeric,date,integer) from public,anon;
grant execute on function private.set_empty_crate_count(uuid,text,numeric,date,integer) to authenticated;
create function public.set_empty_crate_count(
  p_request_id uuid, p_crate_type text, p_quantity numeric,
  p_business_date date, p_expected_quantity integer
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_empty_crate_count(p_request_id,p_crate_type,p_quantity,p_business_date,p_expected_quantity);
$$;
revoke all on function public.set_empty_crate_count(uuid,text,numeric,date,integer) from public,anon;
grant execute on function public.set_empty_crate_count(uuid,text,numeric,date,integer) to authenticated;
commit;
