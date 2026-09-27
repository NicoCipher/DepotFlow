begin;

-- Crate-only price is not always known yet. Let API callers omit it until the
-- business confirms the amount; a missing argument is stored as NULL.
create or replace function private.set_crate_deposit_price(
  p_pocket_count numeric,
  p_complete_amount numeric,
  p_crate_only_amount numeric default null
) returns void
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(
    select 1 from private.shop_owner where user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='Owner only';
  end if;

  if p_pocket_count is null or p_pocket_count='NaN'::numeric
    or p_pocket_count<1 or p_pocket_count>2147483647
    or p_pocket_count<>trunc(p_pocket_count)
    or not exists(
      select 1 from public.crate_types
      where not is_legacy and pocket_count=p_pocket_count::integer
    ) then
    raise exception using errcode='22023',message='Choose a pocket count used by an exact crate type.';
  end if;

  if p_complete_amount is null then
    delete from public.crate_deposit_prices
    where pocket_count=p_pocket_count::integer;
    return;
  end if;

  if p_complete_amount='NaN'::numeric or p_complete_amount<1
    or p_complete_amount>2147483647 or p_complete_amount<>trunc(p_complete_amount)
    or mod(p_complete_amount,50)<>0
    or (p_crate_only_amount is not null and (
      p_crate_only_amount='NaN'::numeric or p_crate_only_amount<1
      or p_crate_only_amount>2147483647 or p_crate_only_amount<>trunc(p_crate_only_amount)
      or mod(p_crate_only_amount,50)<>0
    )) then
    raise exception using errcode='22023',message='Enter deposit prices in whole naira, in ₦50 steps.';
  end if;

  insert into public.crate_deposit_prices(
    pocket_count,complete_crate_amount,crate_only_amount,updated_at
  ) values(
    p_pocket_count::integer,p_complete_amount::integer,p_crate_only_amount::integer,now()
  )
  on conflict(pocket_count) do update set
    complete_crate_amount=excluded.complete_crate_amount,
    crate_only_amount=excluded.crate_only_amount,
    updated_at=excluded.updated_at;
end $$;

create or replace function public.set_crate_deposit_price(
  p_pocket_count numeric,
  p_complete_amount numeric,
  p_crate_only_amount numeric default null
) returns void
language sql security invoker set search_path='' as $$
  select private.set_crate_deposit_price(
    p_pocket_count,p_complete_amount,p_crate_only_amount
  );
$$;

revoke all on function private.set_crate_deposit_price(numeric,numeric,numeric) from public,anon;
grant execute on function private.set_crate_deposit_price(numeric,numeric,numeric) to authenticated;
revoke all on function public.set_crate_deposit_price(numeric,numeric,numeric) from public,anon;
grant execute on function public.set_crate_deposit_price(numeric,numeric,numeric) to authenticated;

commit;
