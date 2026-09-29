-- Disposable import fixture: six existing depot products before the new migration.
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000051');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000051');
insert into public.crate_types(id,name,empty_family,pocket_count) values
  ('50000000-0000-4000-8000-000000000051','Existing 12-bottle crate','NB',12),
  ('50000000-0000-4000-8000-000000000052','Existing 20-bottle crate','NB',20);
insert into public.products
  (id,name,size,bottles_per_crate,full_crate_price,half_crate_price,
   quarter_crate_price,bottle_price,bottles_returnable,bottle_type,crate_type_id)
values
  ('60000000-0000-4000-8000-000000000051','"33" Export',null,12,10500,null,null,1100,true,'"33" Export','50000000-0000-4000-8000-000000000051'),
  ('60000000-0000-4000-8000-000000000052','Big Guinness Stout','60cl',12,16500,null,4150,1700,true,'Big Guiness Stout','50000000-0000-4000-8000-000000000051'),
  ('60000000-0000-4000-8000-000000000053','Castle Lite',null,12,10200,null,null,1000,true,'Castle Lite','50000000-0000-4000-8000-000000000051'),
  ('60000000-0000-4000-8000-000000000054','Desperados',null,20,22000,null,null,1500,true,'Desperados','50000000-0000-4000-8000-000000000052'),
  ('60000000-0000-4000-8000-000000000055','Goldberg',null,12,10200,null,null,1000,true,'Goldberg','50000000-0000-4000-8000-000000000051'),
  ('60000000-0000-4000-8000-000000000056','Trophy',null,12,9200,null,null,1000,true,'Trophy','50000000-0000-4000-8000-000000000051');
insert into public.stock(product_id,total_bottles)
select id,120 from public.products;
create table public.import_baseline as
select count(*) as product_count,
  md5(jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.name,'size',p.size,
    'full',p.full_crate_price,'half',p.half_crate_price,
    'quarter',p.quarter_crate_price,'bottle',p.bottle_price,
    'crate',p.crate_type_id,'bottle_type',p.bottle_type,
    'per_crate',p.bottles_per_crate,'returnable',p.bottles_returnable,
    'stock',s.total_bottles) order by p.id)::text) as unchanged_data_hash
from public.products p join public.stock s on s.product_id=p.id;
