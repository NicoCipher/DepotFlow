do $$
declare v_details text;
begin
  select md5(jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.name,'size',p.size,
    'half',p.half_crate_price,'quarter',p.quarter_crate_price,
    'bottle',p.bottle_price,'crate',p.crate_type_id,'bottle_type',p.bottle_type,
    'per_crate',p.bottles_per_crate,'returnable',p.bottles_returnable,
    'stock',s.total_bottles) order by p.id)::text) into v_details
  from public.products p join public.stock s on s.product_id=p.id;
  if (select product_count from public.import_baseline) <> 6
    or (select count(*) from public.products) <> 6
    or (select non_full_price_hash from public.import_baseline) is distinct from v_details then
    raise exception 'The selling-price import changed IDs, stock or packaging';
  end if;
  if exists (
    select 1 from (values
      ('"33" Export',10300),('Big Guinness Stout',16500),('Castle Lite',10500),
      ('Desperados',22000),('Goldberg',10000),('Trophy',9000)
    ) expected(name,amount)
    left join public.products p on p.name=expected.name
    where p.full_crate_price is distinct from expected.amount
  ) then raise exception 'Configured selling price mismatch'; end if;
  if (select count(*) from public.product_selling_price_history
      where source='confirmed_list' and effective_on='2026-09-29'
      and owner_user_id='00000000-0000-4000-8000-000000000051') <> 25
    or (select count(*) from public.product_selling_price_history
      where source='prior_configuration' and effective_on is null) <> 4 then
    raise exception 'Expected 25 current quotes and 4 previous configured prices';
  end if;
  if (select array_agg(h.selling_price order by h.selling_price)
      from public.product_selling_price_history h
      join public.product_catalogue c on c.id=h.catalogue_product_id
      where c.name='Goldberg') is distinct from array[10000,10200] then
    raise exception 'Goldberg current and previous selling prices were not preserved';
  end if;
  if exists (
    select 1 from (values ('Big Ice',17800),('Small Ice',17900),('Trophy Stout',11600)) expected(name,amount)
    left join public.product_catalogue c on c.name=expected.name
    left join public.product_selling_price_history h on h.catalogue_product_id=c.id
      and h.source='confirmed_list'
    where h.selling_price is distinct from expected.amount
  ) then raise exception 'Confirmed Ice or Trophy Stout price mismatch'; end if;
  if exists (
    select 1 from public.products p join public.product_catalogue c
      on c.id=p.catalogue_product_id
    where c.name in ('Budweiser','Flying Fish')
  ) or not exists (
    select 1 from public.product_selling_price_history h
    join public.product_catalogue c on c.id=h.catalogue_product_id
    where c.name='Budweiser' and h.selling_price=11800
  ) or not exists (
    select 1 from public.product_selling_price_history h
    join public.product_catalogue c on c.id=h.catalogue_product_id
    where c.name='Flying Fish' and h.selling_price=15100
  ) then raise exception 'New catalogue drinks were activated or priced incorrectly'; end if;
  if (select count(*) from public.product_cost_history) <> 40
    or (select count(*) from public.product_catalogue) <> 46 then
    raise exception 'Cost records or catalogue changed';
  end if;
end $$;
