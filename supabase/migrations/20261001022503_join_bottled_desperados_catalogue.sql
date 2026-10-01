begin;
lock table public.product_catalogue, public.products, public.product_cost_history, public.product_selling_price_history in share row exclusive mode;
do $$
declare v_source uuid; v_target uuid; v_products text; v_stock text; v_can text;
begin
  select id into v_source from public.product_catalogue where name='Desperado';
  select id into v_target from public.product_catalogue where name='Desperados';
  if v_source is null or v_target is null then
    raise exception 'Expected bottled Desperado catalogue entries are missing';
  end if;
  if exists(select 1 from public.products where catalogue_product_id=v_source) then
    raise exception 'Both entries may be configured; inspect before joining';
  end if;
  select md5(string_agg(to_jsonb(p)::text,',' order by p.id)) into v_products from public.products p;
  select md5(string_agg(to_jsonb(s)::text,',' order by s.product_id)) into v_stock from public.stock s;
  select md5(string_agg(to_jsonb(h)::text,',' order by h.id)) into v_can
    from public.product_cost_history h join public.product_catalogue c on c.id=h.catalogue_product_id where c.name='Desperados Can';
  update public.product_cost_history set catalogue_product_id=v_target where catalogue_product_id=v_source;
  update public.product_selling_price_history set catalogue_product_id=v_target where catalogue_product_id=v_source;
  update public.product_catalogue set manufacturer=coalesce(manufacturer,(select manufacturer from public.product_catalogue where id=v_source)) where id=v_target;
  delete from public.product_catalogue where id=v_source;
  if v_products is distinct from (select md5(string_agg(to_jsonb(p)::text,',' order by p.id)) from public.products p)
     or v_stock is distinct from (select md5(string_agg(to_jsonb(s)::text,',' order by s.product_id)) from public.stock s)
     or v_can is distinct from (select md5(string_agg(to_jsonb(h)::text,',' order by h.id)) from public.product_cost_history h join public.product_catalogue c on c.id=h.catalogue_product_id where c.name='Desperados Can') then
    raise exception 'Joining catalogue entries changed protected product, stock or can data';
  end if;
end $$;
commit;