-- M2f-7: make exact bottle stock independently countable per business.
-- DRAFT/NO-GO: new-business operational writes are STILL NOT permitted.
-- This migration preserves original legacy NULL-business counting before
-- activation, and old-shop stock/money/receipt semantics after activation.
--
-- PostgreSQL 16 NULLS NOT DISTINCT is intentional: legacy NULL-business
-- rows must still have ONE row per bottle type before audited backfill.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $preflight$
declare
  v_pk text;
  v_count integer;
begin
  select pg_catalog.pg_get_constraintdef(c.oid) into v_pk
  from pg_catalog.pg_constraint c
  where c.conrelid='public.empty_bottle_stock'::regclass and c.contype='p';
  if v_pk is distinct from 'PRIMARY KEY (bottle_type)' then
    raise exception 'Bottle stock identity changed; review migration manually: %',v_pk;
  end if;
  if exists(
    select 1 from pg_catalog.pg_constraint c
    where c.contype='f'
      and c.confrelid='public.empty_bottle_stock'::regclass
  ) then
    raise exception 'Bottle stock has referencing foreign keys; migration review required';
  end if;
  if exists(
    select 1 from public.empty_bottle_stock
    where business_id is not null and not exists(
      select 1 from private.businesses b
      where b.id=public.empty_bottle_stock.business_id
    )
  ) then
    raise exception 'Foreign business identity in bottle stock';
  end if;
  select count(*) into v_count
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname in (
    'save_sale_v2','record_customer_empty_return'
  ) and p.prokind='f';
  if v_count<>2 then
    raise exception 'Expected exactly two active bottle-stock writer functions, found %',v_count;
  end if;
end;
$preflight$;

-- A surrogate physical stock row identity preserves a proper primary key
-- even when business_id is intentionally NULL in preactivation test data.
-- No sales, bottle obligations, receipt or historical UUIDs are changed.
alter table public.empty_bottle_stock
  add column stock_id uuid not null default pg_catalog.gen_random_uuid();

alter table public.empty_bottle_stock
  drop constraint empty_bottle_stock_pkey;

alter table public.empty_bottle_stock
  add constraint empty_bottle_stock_pkey primary key (stock_id);

-- Three distinct rows can now coexist: legacy/Goldberg, shop A/Goldberg,
-- shop B/Goldberg. Same-shop duplicates (including legacy NULLs) are barred.
alter table public.empty_bottle_stock
  add constraint empty_bottle_stock_business_bottle_unique
    unique nulls not distinct (business_id,bottle_type);

-- Fail closed if new business identity is changed after a physical row exists.
-- The existing legacy write-scope trigger still handles owner authorization,
-- exact stamping and bans on all new-business operational writes.
create function private.prevent_bottle_stock_reassignment()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if old.stock_id is distinct from new.stock_id
     or old.business_id is distinct from new.business_id
     or old.bottle_type is distinct from new.bottle_type then
    raise exception using errcode='42501',
      message='A recorded empty bottle stock identity cannot be reassigned.';
  end if;
  return new;
end
$$;
revoke all on function private.prevent_bottle_stock_reassignment()
  from public,anon,authenticated,service_role;
create trigger empty_bottle_stock_identity_immutable
  before update on public.empty_bottle_stock
  for each row execute function private.prevent_bottle_stock_reassignment();

-- Both extant legacy writers use the SAME exact-bottle upsert.
-- Before gate activation the legacy trigger leaves business_id NULL and
-- the NULLS NOT DISTINCT unique key behaves like the old text-only key.
-- After gate activation the row trigger derives the verified old business.
-- Replacing ONLY the ON CONFLICT target preserves every existing function
-- authorization, lock, receipt, money, stock and empties calculation.
do $retarget_exact_bottle_writers$
declare
  r record;
  v_oid oid;
  v_source text;
  v_old constant text:='on conflict(bottle_type) do update';
  v_new constant text:='on conflict(business_id,bottle_type) do update';
  v_matches int;
  v_count int:=0;
begin
  for r in select signature from (values
    ('private.save_sale_v2(uuid,uuid,date,numeric,jsonb,jsonb,jsonb)'),
    ('private.record_customer_empty_return(uuid,uuid,jsonb,jsonb,uuid[])')
  ) x(signature) loop
    v_oid:=pg_catalog.to_regprocedure(r.signature);
    if v_oid is null then
      raise exception 'Bottle writer signature changed: %',r.signature;
    end if;
    select pg_catalog.pg_get_functiondef(v_oid) into v_source;
    v_matches:=(length(v_source)-length(replace(v_source,v_old,'')))
      /length(v_old);
    if v_matches<>1 or pg_catalog.strpos(v_source,v_new)<>0
       or pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0 then
      raise exception 'Bottle writer source drift or missing owner guard: %',r.signature;
    end if;
    execute replace(v_source,v_old,v_new);
    v_count:=v_count+1;
  end loop;
  if v_count<>2 then raise exception 'Exactly two legacy bottle writers required'; end if;
end;
$retarget_exact_bottle_writers$;

-- No authenticated INSERT, UPDATE, DELETE grants are introduced. A separate
-- verified tenant-safe atomic stock/return writer is STILL mandatory before
-- shops other than the original can receive, count or return physical empties.
commit;
