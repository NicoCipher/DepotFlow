begin;
-- Metadata only. No backfill, re-identification, balance or history writes.
-- Existing mismatches are left untouched; future assignments/edits are checked.
create function private.check_product_crate_pockets() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_pockets integer;
begin
  -- SHARE conflicts with metadata UPDATE's row lock. A concurrent assignment
  -- therefore sees either the committed new capacity or holds the old capacity
  -- stable until its product write commits. No product bottle count is changed.
  select pocket_count into v_pockets from public.crate_types where id=new.crate_type_id for share;
  if v_pockets is not null and v_pockets <> new.bottles_per_crate then
    raise exception using errcode='23514',message='Crate pockets must match the product bottles per crate.';
  end if;
  return new;
end $$;
revoke all on function private.check_product_crate_pockets() from public,anon,authenticated;
create trigger product_crate_pockets before insert or update of crate_type_id,bottles_per_crate
on public.products for each row execute function private.check_product_crate_pockets();

create function private.check_crate_product_pockets() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.pocket_count is not null and exists (
    select 1 from public.products where crate_type_id=new.id and bottles_per_crate<>new.pocket_count
  ) then
    raise exception using errcode='23514',message='Pocket count must match every product using this crate.';
  end if;
  return new;
end $$;
revoke all on function private.check_crate_product_pockets() from public,anon,authenticated;
create trigger crate_product_pockets before update on public.crate_types
for each row execute function private.check_crate_product_pockets();

create function private.edit_crate_type(p_id uuid,p_name text,p_empty_family text,p_pocket_count numeric,p_variant text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_is_legacy boolean;
begin
  if auth.uid() is null or not exists(select 1 from private.shop_owner where user_id=auth.uid()) then
    raise exception using errcode='42501',message='Owner only'; end if;
  p_name:=btrim(p_name); p_empty_family:=btrim(p_empty_family); p_variant:=nullif(btrim(p_variant),'');
  if p_id is null or p_name is null or length(p_name) not between 1 and 120
    or p_empty_family is null or length(p_empty_family) not between 1 and 80
    or length(p_variant)>120 or p_pocket_count is null or p_pocket_count<1
    or p_pocket_count>2147483647 or p_pocket_count<>trunc(p_pocket_count) or p_pocket_count='NaN'::numeric then
    raise exception using errcode='22023',message='Enter a name, family and positive whole pocket count.'; end if;
  -- Lock before the trigger checks linked products; retain ID, provenance and timestamps.
  select is_legacy into v_is_legacy from public.crate_types where id=p_id for update;
  if not found then raise exception using errcode='22023',message='Crate type not found.'; end if;
  if v_is_legacy then
    raise exception using errcode='55000',message='This older crate record cannot be edited directly. Create an exact crate type and assign products to it instead.';
  end if;
  update public.crate_types set name=p_name,empty_family=p_empty_family,
    pocket_count=p_pocket_count::integer,variant=p_variant where id=p_id;
  return p_id;
end $$;
revoke all on function private.edit_crate_type(uuid,text,text,numeric,text) from public,anon;
grant execute on function private.edit_crate_type(uuid,text,text,numeric,text) to authenticated;
create function public.edit_crate_type(p_id uuid,p_name text,p_empty_family text,p_pocket_count numeric,p_variant text)
returns uuid language sql security invoker set search_path='' as $$
 select private.edit_crate_type(p_id,p_name,p_empty_family,p_pocket_count,p_variant);
$$;
revoke all on function public.edit_crate_type(uuid,text,text,numeric,text) from public,anon;
grant execute on function public.edit_crate_type(uuid,text,text,numeric,text) to authenticated;
commit;
