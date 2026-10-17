begin;

-- A read-only "not found" is insufficient while an earlier HTTP request
-- may still be queued. A recovery that confirms absence must fence that
-- original request ID so a late split-save cannot ever create it.
create table private.split_sale_request_fences (
  request_id uuid primary key,
  checked_at timestamptz not null default now()
);
alter table private.split_sale_request_fences enable row level security;
revoke all on private.split_sale_request_fences from public,anon,authenticated;

-- This trigger covers the original atomic saver as well as a delayed legacy
-- insert using the same request ID. No financial writes survive a failed sale.
create function private.reject_fenced_sale_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.request_id is not null and exists (
    select 1 from private.split_sale_request_fences f
    where f.request_id = new.request_id
  ) then
    raise exception using errcode='22023',
      message='This sale request was confirmed not saved. Start a new sale request.';
  end if;
  return new;
end;
$$;
create trigger reject_fenced_sale_request
  before insert on public.sales
  for each row execute function private.reject_fenced_sale_request();

-- Status reconciliation is a small private audit write ONLY on confirmed
-- absence, not a sale, payment, stock or receipt operation.
create or replace function public.check_split_sale_request(p_request_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_sale record;
begin
  if (select auth.uid()) is null or not exists (
    select 1 from private.shop_owner where user_id=(select auth.uid())
  ) then
    raise exception using errcode='42501', message='Owner only';
  end if;
  if p_request_id is null then
    raise exception using errcode='22023', message='Check sale request.';
  end if;

  -- Same request key as the writer, so a writer holding the lock completes
  -- before recovery checks. If recovery gets there first, the fence insert
  -- permanently blocks later writers using this original request.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 0));

  select id, payment_method, split_request_hash into v_sale
    from public.sales where request_id=p_request_id;
  if not found then
    insert into private.split_sale_request_fences(request_id)
      values (p_request_id) on conflict (request_id) do nothing;
    return jsonb_build_object('state','absent');
  end if;
  if v_sale.payment_method <> 'mixed' or
    v_sale.split_request_hash is null then
    return jsonb_build_object('state','different');
  end if;
  return jsonb_build_object('state','saved','saleId',v_sale.id);
end;
$$;

revoke all on function public.check_split_sale_request(uuid) from public,anon;
grant execute on function public.check_split_sale_request(uuid) to authenticated;

commit;
