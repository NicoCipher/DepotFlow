-- Disposable migrated database only. All fixtures and changes roll back.
begin;

do $$ begin
  if (select count(*) from public.product_catalogue) <> 45 then
    raise exception 'Expected 40 costed and 5 existing-only catalogue identities';
  end if;
  if (select count(*) from public.product_catalogue where manufacturer='NB') <> 29
    or (select count(*) from public.product_catalogue where manufacturer='GN') <> 11 then
    raise exception 'Manufacturer groups are incorrect';
  end if;
  if (select count(*) from public.product_catalogue where name in
    ('Heineken','Medium Heineken','Heineken Can','Maltina','Maltina Can',
     'Maltina PET 25cl','Maltina PET 33cl','Maltina PET 50cl',
     'Desperado','Desperados','Desperados Can')) <> 11 then
    raise exception 'Variants or ambiguous identities were merged';
  end if;
end $$;

insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000041'),
  ('00000000-0000-4000-8000-000000000042');
insert into private.shop_owner(user_id) values ('00000000-0000-4000-8000-000000000041');

insert into public.product_cost_history(owner_user_id,catalogue_product_id,cost_price,effective_on)
select '00000000-0000-4000-8000-000000000041',id,8600,'2026-09-29'
from public.product_catalogue where name='Goldberg';
insert into public.product_cost_history(owner_user_id,catalogue_product_id,cost_price,effective_on)
select '00000000-0000-4000-8000-000000000041',id,9000,'2026-10-01'
from public.product_catalogue where name='Goldberg';

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000041',true);
do $$ begin
  if (select count(*) from public.product_catalogue) <> 45
    or (select count(*) from public.product_cost_history) <> 2 then
    raise exception 'Owner cannot read catalogue and historical costs';
  end if;
  if (select cost_price from public.product_cost_history order by effective_on desc limit 1) <> 9000 then
    raise exception 'Latest cost missing';
  end if;
  begin
    update public.product_cost_history set cost_price=1;
    raise exception 'Historical cost overwritten through the API';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.product_cost_history(owner_user_id,catalogue_product_id,cost_price,effective_on)
    select '00000000-0000-4000-8000-000000000041',id,1,'2026-10-02'
    from public.product_catalogue where name='Goldberg';
    raise exception 'Direct cost insertion allowed';
  exception when insufficient_privilege then null; end;
end $$;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000042',true);
do $$ begin
  if exists(select 1 from public.product_cost_history)
    or exists(select 1 from public.product_catalogue) then
    raise exception 'Non-owner can see catalogue or another business cost';
  end if;
end $$;

set local role anon;
do $$ begin
  begin
    perform * from public.product_cost_history;
    raise exception 'Anonymous cost access allowed';
  exception when insufficient_privilege then null; end;
end $$;

rollback;
