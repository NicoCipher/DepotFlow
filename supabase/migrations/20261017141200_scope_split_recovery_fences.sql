-- M2f-17 (DRAFT ONLY): make split-save uncertainty fences business-specific.
-- A checked-absent request of shop A must not permanently block shop B.
-- Historical fence IDs remain unchanged; no confirmed money/stock is written.
-- Do NOT deploy while tenant migrations/history are a production NO-GO.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $fence_schema_preflight$
declare v_primary text;
begin
  select pg_catalog.pg_get_constraintdef(oid) into v_primary
  from pg_catalog.pg_constraint
  where conrelid='private.split_sale_request_fences'::regclass
    and conname='split_sale_request_fences_pkey' and contype='p';
  if v_primary is distinct from 'PRIMARY KEY (request_id)' then
    raise exception 'Unexpected split-save fence key: %',v_primary;
  end if;
  if exists(
    select 1 from pg_catalog.pg_constraint
    where contype='f'
      and confrelid='private.split_sale_request_fences'::regclass
  ) then
    raise exception 'Split-save fences acquired referencing FKs; review required';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid='public.sales'::regclass and tgname='reject_fenced_sale_request'
      and tgenabled='O'
  ) then
    raise exception 'Original split-sale late-write fence not enabled';
  end if;
end;
$fence_schema_preflight$;

alter table private.split_sale_request_fences
  add column business_id uuid references private.businesses(id) on delete restrict,
  add column fence_id uuid not null default pg_catalog.gen_random_uuid();
alter table private.split_sale_request_fences
  drop constraint split_sale_request_fences_pkey;
alter table private.split_sale_request_fences
  add constraint split_sale_request_fences_pkey primary key (fence_id);
alter table private.split_sale_request_fences
  add constraint split_sale_request_fences_business_request_unique
    unique nulls not distinct (business_id,request_id);

-- Legacy fences that predate the audited operational backfill keep a NULL
-- business_id. The insert trigger treats those original singleton fences
-- as belonging ONLY to a verified legacy owner, before and after backfill.
-- Never infer the new-business identity from a caller-supplied field.
do $scope_late_sale_rejection$
declare
  v_oid oid := 'private.reject_fenced_sale_request()'::regprocedure;
  v_source text;
  v_from constant text :=
    E'from private.split_sale_request_fences f\n    where f.request_id = new.request_id';
  v_to constant text :=
    E'from private.split_sale_request_fences f\n    where f.request_id = new.request_id\n'
    || E'      and (f.business_id is not distinct from new.business_id\n'
    || E'        or (f.business_id is null\n'
    || E'          and private.can_read_legacy_customer(new.business_id)))';
begin
  select pg_catalog.pg_get_functiondef(v_oid) into v_source;
  if v_source is null
    or (length(v_source)-length(replace(v_source,v_from,'')))/length(v_from)<>1
    or pg_catalog.strpos(v_source,'private.can_read_legacy_customer(')<>0 then
    raise exception 'Split-save insert fence source drift';
  end if;
  execute replace(v_source,v_from,v_to);
end;
$scope_late_sale_rejection$;

-- Keep the original lock and original request UUID. The recovery remains
-- legacy-only; second-depot recovery needs its own reviewed authenticated RPC.
-- A known foreign sale must not suppress an own-shop absence fence, and a
-- known own sale must never be missed because a foreign sale shares its ID.
do $scope_read_only_check_sale$
declare
  v_oid oid := 'public.check_split_sale_request(uuid)'::regprocedure;
  v_source text;
  v_old_select constant text :=
    'from public.sales where request_id=p_request_id;';
  v_new_select constant text :=
    E'from public.sales where request_id=p_request_id\n'
    || '      and private.can_read_legacy_customer(business_id);';
  v_old_fence constant text :=
    E'insert into private.split_sale_request_fences(request_id)\n'
    || E'      values (p_request_id) on conflict (request_id) do nothing;';
  v_new_fence constant text :=
    E'insert into private.split_sale_request_fences(request_id,business_id)\n'
    || E'      values (p_request_id, (\n'
    || E'        select g.business_id from private.legacy_write_scope_gate g\n'
    || E'        where g.enabled is true\n'
    || E'      )) on conflict (business_id,request_id) do nothing;';
begin
  select pg_catalog.pg_get_functiondef(v_oid) into v_source;
  if v_source is null
    or pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')=0
    or (length(v_source)-length(replace(v_source,v_old_select,'')))
       /length(v_old_select)<>1
    or (length(v_source)-length(replace(v_source,v_old_fence,'')))
       /length(v_old_fence)<>1 then
    raise exception 'Read-only Check Sale source drift; manual reconciliation';
  end if;
  v_source:=replace(v_source,v_old_select,v_new_select);
  v_source:=replace(v_source,v_old_fence,v_new_fence);
  execute v_source;
end;
$scope_read_only_check_sale$;

-- Nothing here grants another business permission to record sales, payments
-- or perform Check Sale. Production rollout still requires a verified clone,
-- tenant-aware atomic writer and correlated receipt/recovery contract.
commit;
