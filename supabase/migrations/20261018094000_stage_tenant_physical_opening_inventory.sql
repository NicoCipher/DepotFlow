-- M2f-28: one-time physical opening for drink stock and exact held empties.
-- Each line is atomic with existing owner-verified stock-count audit/event.
-- Not a bulk stock import; checkout, deposits and sales remain blocked.
-- DRAFT / NO-GO: gate OFF and no browser EXECUTE grants.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create table private.business_physical_opening_gate(
 singleton boolean primary key default true check(singleton is true),
 enabled boolean not null default false
);
insert into private.business_physical_opening_gate(singleton,enabled)
 values(true,false);
alter table private.business_physical_opening_gate enable row level security;
revoke all on private.business_physical_opening_gate
 from public,anon,authenticated,service_role;

-- Private immutable idempotent line. UUID is business-scoped and cannot be
-- recycled for a different kind/physical identity in the SAME business.
create table private.business_physical_opening_lines (
 business_id uuid not null references private.businesses(id) on delete restrict,
 request_id uuid not null,
 actor_id uuid not null references auth.users(id) on delete restrict,
 kind text not null check(kind in ('drink','crate','bottle')),
 resource_key text not null check(length(resource_key) between 1 and 120),
 request_payload jsonb not null,
 result jsonb not null,
 business_date date not null,
 created_at timestamptz not null default now(),
 primary key(business_id,request_id),
 unique(business_id,kind,resource_key)
);
alter table private.business_physical_opening_lines enable row level security;
revoke all on private.business_physical_opening_lines
 from public,anon,authenticated,service_role;

-- p_quantity = WHOLE FULL DRINK CRATES for 'drink', or total physically
-- held EMPTY CRATES / EMPTY BOTTLES for other kinds.
-- p_loose is extra loose full drink bottles; p_pack is pack count from the
-- owned product and must be zero for physical empties.
create function public.record_business_physical_opening(
 p_business_id uuid,p_request_id uuid,p_kind text,p_resource text,
 p_quantity integer,p_loose integer,p_pack integer,p_business_date date
) returns jsonb
language plpgsql security definer set search_path=''
as $opening$
declare
 v_actor uuid:=auth.uid();
 v_key text;
 v_payload jsonb;
 v_prior private.business_physical_opening_lines%rowtype;
 v_result jsonb;
 v_id uuid;
begin
 if v_actor is null or p_business_id is null then
  raise exception 'Verified business owner session required'
   using errcode='42501';
 end if;
 -- A previously saved inventory-opening request is visible ONLY while this
 -- actor still owns the verified SETUP-state business.
 perform 1 from private.business_memberships m
 join private.businesses b on b.id=m.business_id
 where m.business_id=p_business_id and m.user_id=v_actor
  and m.member_kind='owner' and m.status='active'
  and b.legacy_singleton is null and b.status='setup'
 for share of m,b;
 if not found then
  raise exception 'Business setup is not available' using errcode='42501';
 end if;
 perform 1 from private.business_physical_opening_gate
   where enabled is true for share;
 if not found or not exists(
   select 1 from private.legacy_write_scope_gate where enabled is true
 ) then
  raise exception 'Physical opening inventory is not available'
   using errcode='42501';
 end if;
 if p_request_id is null or p_kind not in ('drink','crate','bottle')
   or p_kind is null or p_resource is null
   or p_quantity is null or p_quantity<0
   or p_loose is null or p_loose<0
   or p_pack is null or p_pack<0
   or p_business_date is null
   or p_business_date>(pg_catalog.now() at time zone 'Africa/Lagos')::date
 then
   raise exception 'Check the physical opening count and date'
    using errcode='22023';
 end if;
 if p_kind in ('drink','crate') then
  if pg_catalog.btrim(p_resource) !~
     '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception 'Choose an exact owned drink or crate'
     using errcode='22023';
  end if;
  v_id:=pg_catalog.btrim(p_resource)::uuid;
  v_key:=v_id::text;
 else
  v_key:=pg_catalog.btrim(p_resource);
  if pg_catalog.length(v_key) not between 1 and 120 then
   raise exception 'Choose an existing returnable bottle type'
    using errcode='22023';
  end if;
 end if;
 if p_kind='drink' then
  if p_pack<=0 or p_loose>=p_pack
     or p_quantity::numeric*p_pack+p_loose>2147483647 then
    raise exception 'Check whole crates, loose bottles and pack size'
      using errcode='22023';
  end if;
 elsif p_loose<>0 or p_pack<>0 then
  raise exception 'Physical empties are counted as whole units'
    using errcode='22023';
 end if;

 v_payload:=pg_catalog.jsonb_build_object(
  'kind',p_kind,'resource',v_key,'quantity',p_quantity,
  'loose',p_loose,'pack',p_pack,'businessDate',p_business_date
 );
 -- Same advisory namespace as the existing owner-verified physical count
 -- RPCs. Nested advisory acquisition is transaction-reentrant.
 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    p_business_id::text||':'||p_request_id::text,0));
 select * into v_prior from private.business_physical_opening_lines
  where business_id=p_business_id and request_id=p_request_id for update;
 if found then
  if v_prior.actor_id is distinct from v_actor
    or v_prior.request_payload is distinct from v_payload then
   raise exception 'Opening count request already used with different details'
    using errcode='22023';
  end if;
  return pg_catalog.jsonb_build_object(
   'requestId',p_request_id,'businessId',p_business_id,
   'kind',p_kind,'resource',v_key,'count',v_prior.result
  );
 end if;

 -- A request UUID already used for any different stock operation must NOT
 -- be relabeled as an opening by replaying the underlying count function.
 if exists(select 1 from private.business_product_stock_counts
           where business_id=p_business_id and request_id=p_request_id)
 or exists(select 1 from private.business_empty_bottle_counts
           where business_id=p_business_id and request_id=p_request_id)
 or exists(select 1 from private.business_empty_crate_counts
           where business_id=p_business_id and request_id=p_request_id)
 or exists(select 1 from private.business_receiving_requests
           where business_id=p_business_id and request_id=p_request_id) then
  raise exception 'Stock request already exists outside physical opening'
   using errcode='22023';
 end if;
 if exists(
   select 1 from private.business_physical_opening_lines
    where business_id=p_business_id and kind=p_kind and resource_key=v_key
 ) then
  raise exception 'Physical opening already recorded for this exact item'
   using errcode='22023';
 end if;

 if p_kind='drink' then
  -- No pre-existing stock row, even quantity 0. Zero is a confirmed count,
  -- not proof that a product was never counted before.
  if not exists(select 1 from public.products
                where business_id=p_business_id and id=v_id)
     or exists(select 1 from public.stock
               where business_id=p_business_id and product_id=v_id) then
   raise exception 'Drink already counted or does not belong to business'
    using errcode='22023';
  end if;
  v_result:=public.count_business_product_stock(
   p_business_id,p_request_id,v_id,p_quantity,p_loose,0,
   p_pack,p_business_date
  );
 elsif p_kind='crate' then
  if not exists(
    select 1 from public.crate_types
    where business_id=p_business_id and id=v_id and is_legacy is false
  ) or exists(
    select 1 from public.empty_crate_stock
    where business_id=p_business_id and crate_type_id=v_id
  ) then
    raise exception 'Empty crate already counted or belongs to another business'
     using errcode='22023';
  end if;
  v_result:=public.count_business_empty_crates(
    p_business_id,p_request_id,v_id,p_quantity,0,p_business_date
  );
 else
  -- Count only bottle types belonging to a returnable drink in THIS depot.
  if not exists(
    select 1 from public.products
    where business_id=p_business_id and bottles_returnable is true
      and bottle_type=v_key
  ) or exists(
    select 1 from public.empty_bottle_stock
    where business_id=p_business_id and bottle_type=v_key
  ) then
    raise exception 'Empty bottle type is not owned or already counted'
     using errcode='22023';
  end if;
  v_result:=public.count_business_empty_bottles(
   p_business_id,p_request_id,v_key,p_quantity,0,p_business_date
  );
 end if;
 -- The SAME transaction commits or rolls back the exact stock count and
 -- its immutable opening tag. If final event storage fails, the count and
 -- its own stock audit also roll back.
 insert into private.business_physical_opening_lines(
   business_id,request_id,actor_id,kind,resource_key,
   request_payload,result,business_date
 ) values(
   p_business_id,p_request_id,v_actor,p_kind,v_key,
   v_payload,v_result,p_business_date
 );
 return pg_catalog.jsonb_build_object(
   'requestId',p_request_id,'businessId',p_business_id,
   'kind',p_kind,'resource',v_key,'count',v_result
 );
end;
$opening$;
revoke all on function public.record_business_physical_opening(
 uuid,uuid,text,text,integer,integer,integer,date
) from public,anon,authenticated,service_role;
commit;
