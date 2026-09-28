begin;

-- Foreign keys protect every recorded use, including private stock receipts.
-- Do not cascade: historical records and configured swap rules must survive.
create function private.delete_unused_crate_type(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not exists(
    select 1 from private.shop_owner where user_id=auth.uid()
  ) then
    raise exception using errcode='42501',message='Owner only';
  end if;
  if p_id is null then
    raise exception using errcode='22023',message='Choose a crate type.';
  end if;

  delete from public.crate_types where id=p_id;
  if not found then
    raise exception using errcode='P0002',message='Crate type not found.';
  end if;
  -- A concurrent reference either takes the FK lock first and blocks this
  -- delete, or sees the missing parent and fails. Both preserve data.
end $$;

revoke all on function private.delete_unused_crate_type(uuid) from public,anon;
grant execute on function private.delete_unused_crate_type(uuid) to authenticated;

create function public.delete_unused_crate_type(p_id uuid)
returns void language sql security invoker set search_path='' as $$
  select private.delete_unused_crate_type(p_id);
$$;
revoke all on function public.delete_unused_crate_type(uuid) from public,anon;
grant execute on function public.delete_unused_crate_type(uuid) to authenticated;

commit;
