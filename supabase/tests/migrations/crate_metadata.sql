-- Run on a disposable DB migrated through empty_crate_counts only.
-- Reuse the populated one-to-one identity migration fixture, then apply the
-- actual metadata migration and compare every existing record in both directions.
\set ON_ERROR_STOP on
\ir crate_type_identity.sql
create temporary table before_metadata(source text, value jsonb);
do $$ declare t text; begin
 foreach t in array array['crate_types','products','empty_crate_stock','empty_crate_movements','stock','stock_movements','sale_items','crate_obligations'] loop
  execute format('insert into before_metadata select %L,to_jsonb(t) from public.%I t',t,t);
 end loop;
 insert into before_metadata select 'retry',to_jsonb(r) from private.stock_receipts r;
end $$;
\ir ../../migrations/20260914051020_crate_metadata_management.sql
create temporary table after_metadata(source text, value jsonb);
do $$ declare t text; begin
 foreach t in array array['crate_types','products','empty_crate_stock','empty_crate_movements','stock','stock_movements','sale_items','crate_obligations'] loop
  execute format('insert into after_metadata select %L,to_jsonb(t) from public.%I t',t,t);
 end loop;
 insert into after_metadata select 'retry',to_jsonb(r) from private.stock_receipts r;
 if exists((table before_metadata except all table after_metadata) union all (table after_metadata except all table before_metadata)) then
  raise exception 'Metadata migration altered existing data';
 end if;
end $$;
