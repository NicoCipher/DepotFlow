-- M2f-23: one shared catalogue identity may appear in many
-- independent businesses' configured assortments. The old unique key was
-- accidentally global and prevented B from selling a drink configured by A.
--
-- No customer/shop creation or product DML grant. Original product UUIDs,
-- catalogue IDs, price history, stock, receipts and images are preserved.
-- Draft only: must not be deployed before M2 migration-history reconciliation.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $preflight_assortment_index$
declare
  v_index regclass := pg_catalog.to_regclass('public.products_catalogue_product_id_key');
  v_indexdef text;
begin
  if v_index is null then
    raise exception 'Historical single-shop catalogue uniqueness index missing';
  end if;
  select pg_catalog.pg_get_indexdef(v_index) into v_indexdef;
  if pg_catalog.strpos(v_indexdef,
      'UNIQUE INDEX products_catalogue_product_id_key')=0
    or pg_catalog.strpos(v_indexdef,
      '(catalogue_product_id)')=0
    or pg_catalog.strpos(v_indexdef,
      'catalogue_product_id IS NOT NULL')=0 then
    raise exception 'Catalogue assortment uniqueness source drift: %',v_indexdef;
  end if;
end;
$preflight_assortment_index$;

-- Legacy NULL-business rows remain globally unique before owner backfill.
-- Shop A and B are separate uniqueness domains after the audited backfill.
create unique index products_business_catalogue_id_unique
  on public.products(business_id,catalogue_product_id)
  nulls not distinct
  where catalogue_product_id is not null;

drop index public.products_catalogue_product_id_key;

-- New-business product creation remains denied until separately reviewed
-- membership+crate+catalogue setup RPC is implemented with its gate disabled.
commit;
