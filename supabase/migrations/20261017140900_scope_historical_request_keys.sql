-- M2f-14: give both historical opening balances and customer empties
-- tenant-qualified request identity. Existing UUID values/receipt links remain.
-- This is part of the draft-only NO-GO multi-business release.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $request_identity_preflight$
declare
  v_opening text;
  v_returns text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into v_opening
    from pg_catalog.pg_constraint
   where conrelid='public.customer_opening_balances'::regclass
     and conname='customer_opening_balances_request_id_key' and contype='u';
  select pg_catalog.pg_get_constraintdef(oid) into v_returns
    from pg_catalog.pg_constraint
   where conrelid='private.customer_empty_returns'::regclass
     and conname='customer_empty_returns_pkey' and contype='p';
  if v_opening is distinct from 'UNIQUE (request_id)'
      or v_returns is distinct from 'PRIMARY KEY (request_id)' then
    raise exception 'Historical request keys have changed; manual release review required: % / %',
      v_opening,v_returns;
  end if;
  if exists(
    select 1 from pg_catalog.pg_constraint k
    where k.contype='f' and k.confrelid in (
      'public.customer_opening_balances'::regclass,
      'private.customer_empty_returns'::regclass
    )
  ) then
    raise exception 'Historical request tables acquired referencing foreign keys; review required';
  end if;
end;
$request_identity_preflight$;

-- Existing history retains request_id unchanged. A new row identity is
-- needed because a PRIMARY KEY cannot allow a NULL preactivation business_id.
alter table private.customer_empty_returns
  add column return_event_id uuid not null default pg_catalog.gen_random_uuid();
alter table private.customer_empty_returns
  drop constraint customer_empty_returns_pkey;
alter table private.customer_empty_returns
  add constraint customer_empty_returns_pkey primary key (return_event_id);

-- NULLS NOT DISTINCT is deliberate: original pre-backfill shop events still
-- retain the old exactly-once request-ID behavior.
alter table private.customer_empty_returns
  add constraint customer_empty_returns_business_request_unique
  unique nulls not distinct (business_id,request_id);

alter table public.customer_opening_balances
  drop constraint customer_opening_balances_request_id_key;
alter table public.customer_opening_balances
  add constraint customer_opening_balances_business_request_unique
  unique nulls not distinct (business_id,request_id);

-- Original shop lookups are already scoped by M2f-12/13. The financial
-- sale/payment constraints and recovery fence remain GLOBAL: they require
-- their own separately reviewed rewrite before any new-shop checkout.
-- This migration does not grant a new-business financial or return API.
commit;
