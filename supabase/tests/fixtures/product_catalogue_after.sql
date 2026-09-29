do $$
declare v_hash text;
begin
  select md5(jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.name,'size',p.size,
    'full',p.full_crate_price,'half',p.half_crate_price,
    'quarter',p.quarter_crate_price,'bottle',p.bottle_price,
    'crate',p.crate_type_id,'bottle_type',p.bottle_type,
    'per_crate',p.bottles_per_crate,'returnable',p.bottles_returnable,
    'stock',s.total_bottles) order by p.id)::text) into v_hash
  from public.products p join public.stock s on s.product_id=p.id;
  if (select product_count from public.import_baseline) <> 6
    or (select count(*) from public.products) <> 6
    or (select unchanged_data_hash from public.import_baseline) <> v_hash then
    raise exception 'Existing IDs, prices, packaging or stock were changed';
  end if;
  if (select count(*) from public.product_catalogue) <> 43
    or (select count(*) from public.product_cost_history) <> 40
    or (select count(distinct catalogue_product_id) from public.product_cost_history) <> 40 then
    raise exception 'Catalogue or depot costs missing or duplicated';
  end if;
  if (select count(*) from public.products where catalogue_product_id is not null) <> 6 then
    raise exception 'Existing assortment was not linked';
  end if;
  if exists (
    select 1 from public.products p join public.product_catalogue c on c.id=p.catalogue_product_id
    where (p.name='"33" Export' and c.name<>'33')
       or (p.name='Big Guinness Stout' and c.name<>'Big Stout')
       or (p.name='Goldberg' and c.name<>'Goldberg')
       or (p.name='Desperados' and c.name<>'Desperados')
  ) then raise exception 'Existing product mapped to wrong catalogue identity'; end if;
  if not exists (
    select 1 from public.product_catalogue c
    join public.product_cost_history h on h.catalogue_product_id=c.id
    where c.name='Desperado' and h.cost_price=21000
      and h.effective_on='2026-09-29'
      and not exists(select 1 from public.products p where p.catalogue_product_id=c.id)
  ) then raise exception 'Ambiguous Desperado merged into existing Desperados'; end if;
  if (select count(*) from public.product_cost_history where effective_on='2026-09-29'
      and owner_user_id='00000000-0000-4000-8000-000000000051') <> 40 then
    raise exception 'Costs not scoped to this owner and effective date';
  end if;
  if not exists (
    select 1 from public.product_cost_history h
    join public.product_catalogue c on c.id=h.catalogue_product_id
    where c.name='Goldberg' and h.cost_price=8600
  ) or not exists (
    select 1 from public.product_cost_history h
    join public.product_catalogue c on c.id=h.catalogue_product_id
    where c.name='Big Stout' and h.cost_price=15480
  ) then raise exception 'Matched product costs incorrect'; end if;
end $$;
