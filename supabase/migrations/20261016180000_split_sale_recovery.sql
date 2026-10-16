begin;

-- Read-only authority for Check Sale during an emergency split-tender
-- feature rollback. The same advisory transaction lock is acquired by the
-- split saver BEFORE checking or creating a sale under this request ID.
-- No stock, money, receipt or tender rows are written here.
create function public.check_split_sale_request(p_request_id uuid)
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text, 0));

  select id, payment_method, split_request_hash into v_sale
    from public.sales where request_id=p_request_id;
  if not found then
    return jsonb_build_object('state','absent');
  end if;
  if v_sale.payment_method <> 'mixed' or
    v_sale.split_request_hash is null then
    return jsonb_build_object('state','different');
  end if;
  return jsonb_build_object('state','saved','saleId',v_sale.id);
end;
$$;

revoke all on function public.check_split_sale_request(uuid) from public, anon, authenticated;
grant execute on function public.check_split_sale_request(uuid) to authenticated;

commit;
