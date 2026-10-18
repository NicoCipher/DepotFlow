-- M2f-27: stage independently atomic initial CUSTOMER balances for new depots.
-- Existing money owed, refundable deposits, crates/bottles owed and the
-- immutable opening history are written in ONE transaction, never as a sale.
-- DRAFT: default-OFF gate, no authenticated/anon RPC grant or production rollout.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- M2f-14 already changed the global request key to an explicit
-- business-qualified uniqueness rule. Verify it; never drop it twice.
do $customer_opening_request_preflight$
declare v_definition text;
begin
 select pg_catalog.pg_get_constraintdef(oid) into v_definition
 from pg_catalog.pg_constraint
 where conrelid='public.customer_opening_balances'::regclass
   and conname='customer_opening_balances_business_request_unique'
   and contype='u';
 if v_definition is distinct from
     'UNIQUE NULLS NOT DISTINCT (business_id, request_id)' then
  raise exception 'Existing business opening request uniqueness drift: %',v_definition;
 end if;
end;
$customer_opening_request_preflight$;

alter table public.customer_opening_balances
 add column deposit_amount integer not null default 0 check(deposit_amount>=0);

create table private.business_customer_opening_gate (
 singleton boolean primary key default true check(singleton is true),
 enabled boolean not null default false
);
insert into private.business_customer_opening_gate(singleton,enabled)
 values(true,false);
alter table private.business_customer_opening_gate enable row level security;
revoke all on private.business_customer_opening_gate
 from public,anon,authenticated,service_role;

-- A new owner sees only their business's OPENING and resulting money,
-- refundable deposit and physical-empties obligations. Original owner
-- retains the previously verified original-shop business predicate.
do $enable_business_opening_read$
declare v_table text;
begin
 foreach v_table in array array[
  'customer_opening_balances','money_owed','deposits',
  'crate_obligations','bottle_obligations'
 ] loop
  if not exists (
    select 1 from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid=p.polrelid
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname=v_table
      and p.polname='owner_read' and p.polcmd='r'
  ) then
    raise exception 'Expected read fence missing for %',v_table;
  end if;
  execute pg_catalog.format(
    'alter policy owner_read on public.%I using
       (private.can_read_legacy_customer(business_id)
        or private.can_manage_new_customer(business_id))',v_table);
 end loop;
end;
$enable_business_opening_read$;

-- Extend the existing audited row-stamping trigger for ONLY the five
-- opening balance INSERT types. No UPDATE/DELETE or direct API grants.
do $scope_business_customer_opening_writes$
declare
 v_oid oid:='private.scope_legacy_operational_write()'::regprocedure;
 v_src text;
 v_anchor constant text:=
   E'\n  v_actor := auth.uid();\n  -- Lock the authorization rows until the write transaction completes.';
 v_branch constant text:=$branch$
  if tg_table_name in (
      'customer_opening_balances','money_owed','deposits',
      'crate_obligations','bottle_obligations'
     ) and tg_op='INSERT' and new.business_id is not null
     and new.business_id is distinct from v_business then
    if not exists(
       select 1 from private.business_customer_opening_gate
       where enabled is true
    ) then
      raise exception 'Business customer opening balances are unavailable'
        using errcode='42501';
    end if;
    v_actor:=auth.uid();
    if v_actor is null then
      raise exception 'Verified business owner session required'
        using errcode='42501';
    end if;
    perform 1 from private.business_memberships m
     join private.businesses b on b.id=m.business_id
     where m.business_id=new.business_id and m.user_id=v_actor
       and m.member_kind='owner' and m.status='active'
       and b.legacy_singleton is null and b.status='setup'
     for share of m,b;
    if not found then
      raise exception 'Business setup is not available'
        using errcode='42501';
    end if;
    return new;
  end if;

$branch$;
begin
 v_src:=pg_catalog.pg_get_functiondef(v_oid);
 if v_src is null
    or (pg_catalog.length(v_src)
      -pg_catalog.length(pg_catalog.replace(v_src,v_anchor,'')))
       /pg_catalog.length(v_anchor)<>1
    or pg_catalog.strpos(v_src,'private.business_cost_history_gate')=0
    or pg_catalog.strpos(v_src,'private.business_customer_opening_gate')<>0 then
    raise exception 'Customer opening trigger source drift';
 end if;
 execute pg_catalog.replace(v_src,v_anchor,v_branch||v_anchor);
end;
$scope_business_customer_opening_writes$;

create function public.record_business_customer_opening(
 p_business_id uuid,p_request_id uuid,p_customer_id uuid,
 p_amount integer,p_deposit integer,p_business_date date,
 p_note text,p_crates jsonb,p_bottles jsonb
) returns jsonb
language plpgsql security definer set search_path=''
as $opening$
declare
 v_actor uuid:=auth.uid();
 v_customer public.customers%rowtype;
 v_existing public.customer_opening_balances%rowtype;
 v_crate public.crate_types%rowtype;
 v_row jsonb;
 v_payload jsonb;
 v_normal_crates jsonb:='[]'::jsonb;
 v_normal_bottles jsonb:='[]'::jsonb;
 v_quantity integer;
 v_opening uuid;
 v_type uuid;
 v_note text;
begin
 -- Auth/gate precede even immutable request replay; revoked owners cannot
 -- enumerate another business's customer histories via definer privileges.
 if v_actor is null or p_business_id is null then
  raise exception 'Verified business owner session required' using errcode='42501';
 end if;
 perform 1 from private.business_memberships m
 join private.businesses b on b.id=m.business_id
 where m.business_id=p_business_id and m.user_id=v_actor
   and m.member_kind='owner' and m.status='active'
   and b.legacy_singleton is null and b.status='setup'
 for share of m,b;
 if not found then
  raise exception 'Business setup is not available' using errcode='42501';
 end if;
 perform 1 from private.business_customer_opening_gate
  where enabled is true for share;
 if not found or not exists(
  select 1 from private.legacy_write_scope_gate where enabled is true
 ) then
  raise exception 'Business customer opening balances are unavailable'
   using errcode='42501';
 end if;

 if p_request_id is null or p_customer_id is null
    or p_amount is null or p_amount<0
    or p_deposit is null or p_deposit<0
    or p_business_date is null
    or p_business_date>(pg_catalog.now() at time zone 'Africa/Lagos')::date
    or p_note is null or pg_catalog.length(p_note)>300
    or pg_catalog.jsonb_typeof(p_crates) is distinct from 'array'
    or pg_catalog.jsonb_typeof(p_bottles) is distinct from 'array' then
  raise exception 'Check the customer's opening balances'
   using errcode='22023';
 end if;
 if pg_catalog.jsonb_array_length(p_crates)>100
    or pg_catalog.jsonb_array_length(p_bottles)>100
    or (p_amount=0 and p_deposit=0
        and pg_catalog.jsonb_array_length(p_crates)=0
        and pg_catalog.jsonb_array_length(p_bottles)=0) then
  raise exception 'Enter at least one real opening balance'
   using errcode='22023';
 end if;

 v_note:=pg_catalog.btrim(p_note);
 v_payload:=pg_catalog.jsonb_build_object(
  'customer',p_customer_id,'moneyOwed',p_amount,'depositHeld',p_deposit,
  'date',p_business_date,'note',v_note,
  'crates',p_crates,'bottles',p_bottles
 );

 perform pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
   p_business_id::text||':'||p_request_id::text,0
  )
 );
 select * into v_existing from public.customer_opening_balances
  where business_id=p_business_id and request_id=p_request_id for update;
 if found then
  if v_existing.customer_id is distinct from p_customer_id
     or v_existing.request_payload is distinct from v_payload then
    raise exception 'Opening request already used with different details'
      using errcode='22023';
  end if;
  return pg_catalog.jsonb_build_object(
   'openingId',v_existing.id,'requestId',p_request_id,
   'businessId',p_business_id,'customerId',p_customer_id,
   'moneyOwed',v_existing.amount,'depositHeld',v_existing.deposit_amount,
   'crates',v_existing.crates,'bottles',v_existing.bottles,
   'businessDate',v_existing.business_date
  );
 end if;

 -- Serialize ALL first balances for a single customer. Do not ADD them
 -- blindly to balances that may already exist from another workflow.
 select * into v_customer from public.customers
  where id=p_customer_id and business_id=p_business_id
    and archived_at is null for update;
 if not found then
  raise exception 'Customer is not available in this business'
    using errcode='22023';
 end if;
 if exists(
     select 1 from public.customer_opening_balances
      where business_id=p_business_id and customer_id=p_customer_id
   ) or exists(
     select 1 from public.money_owed
      where business_id=p_business_id and customer_id=p_customer_id
   ) or exists(
     select 1 from public.deposits
      where business_id=p_business_id and customer_id=p_customer_id
   ) or exists(
     select 1 from public.crate_obligations
      where business_id=p_business_id and customer_id=p_customer_id
   ) or exists(
     select 1 from public.bottle_obligations
      where business_id=p_business_id and customer_id=p_customer_id
   ) then
  raise exception 'Customer already has balances; opening cannot be added'
    using errcode='22023';
 end if;

 if exists(
  select 1 from pg_catalog.jsonb_array_elements(p_crates) x
    group by x->>'type' having count(*)>1
 ) or exists(
  select 1 from pg_catalog.jsonb_array_elements(p_bottles) x
    group by x->>'type' having count(*)>1
 ) then
  raise exception 'Duplicate crate or bottle type in opening balances'
    using errcode='22023';
 end if;
 -- Validate every physical identity BEFORE writing balances. Crates are
 -- matched by business-owned UUID; equal pocket counts never imply sharing.
 for v_row in select value from pg_catalog.jsonb_array_elements(p_crates) loop
  if pg_catalog.jsonb_typeof(v_row) is distinct from 'object'
     or (v_row->>'type') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or (v_row->>'quantity') !~ '^[1-9][0-9]*$'
     or pg_catalog.length(v_row->>'quantity')>10
     or (v_row->>'quantity')::numeric>2147483647 then
   raise exception 'Check opening crate types and quantities'
     using errcode='22023';
  end if;
  v_type:=(v_row->>'type')::uuid;
  select * into v_crate from public.crate_types
   where business_id=p_business_id and id=v_type
     and is_legacy is false and pocket_count is not null
     and empty_family is not null for share;
  if not found then
   raise exception 'Opening crate does not belong to this depot'
     using errcode='22023';
  end if;
  v_quantity:=(v_row->>'quantity')::integer;
  v_normal_crates:=v_normal_crates||pg_catalog.jsonb_build_array(
   pg_catalog.jsonb_build_object(
     'type',v_type,'name',v_crate.name,'quantity',v_quantity));
 end loop;
 for v_row in select value from pg_catalog.jsonb_array_elements(p_bottles) loop
  if pg_catalog.jsonb_typeof(v_row) is distinct from 'object'
     or pg_catalog.length(pg_catalog.btrim(v_row->>'type')) not between 1 and 120
     or (v_row->>'quantity') !~ '^[1-9][0-9]*$'
     or pg_catalog.length(v_row->>'quantity')>10
     or (v_row->>'quantity')::numeric>2147483647 then
    raise exception 'Check opening bottle types and quantities'
      using errcode='22023';
  end if;
  if not exists(
    select 1 from public.products
     where business_id=p_business_id and bottles_returnable is true
       and bottle_type=v_row->>'type' for share
  ) then
    raise exception 'Opening bottle type does not belong to this depot'
      using errcode='22023';
  end if;
  v_quantity:=(v_row->>'quantity')::integer;
  v_normal_bottles:=v_normal_bottles||pg_catalog.jsonb_build_array(
   pg_catalog.jsonb_build_object(
    'type',v_row->>'type','name',v_row->>'type','quantity',v_quantity));
 end loop;

 if p_amount>0 then
  insert into public.money_owed(customer_id,business_id,amount)
   values(p_customer_id,p_business_id,p_amount);
 end if;
 if p_deposit>0 then
  insert into public.deposits(customer_id,business_id,amount)
   values(p_customer_id,p_business_id,p_deposit);
 end if;
 for v_row in select value from pg_catalog.jsonb_array_elements(v_normal_crates) loop
  insert into public.crate_obligations(
   customer_id,business_id,crate_type_id,crate_type,quantity
  ) values(
   p_customer_id,p_business_id,(v_row->>'type')::uuid,
   v_row->>'name',(v_row->>'quantity')::integer
  );
 end loop;
 for v_row in select value from pg_catalog.jsonb_array_elements(v_normal_bottles) loop
  insert into public.bottle_obligations(
   customer_id,business_id,bottle_type,quantity
  ) values(
   p_customer_id,p_business_id,v_row->>'type',
   (v_row->>'quantity')::integer
  );
 end loop;
 -- Immutable event is part of the SAME SQL transaction as all balances.
 -- No sale, payment, stock movement or external side effect is produced.
 insert into public.customer_opening_balances(
  business_id,customer_id,request_id,amount,deposit_amount,
  business_date,note,crates,bottles,request_payload
 ) values(
  p_business_id,p_customer_id,p_request_id,p_amount,p_deposit,
  p_business_date,v_note,v_normal_crates,v_normal_bottles,v_payload
 ) returning id into v_opening;
 return pg_catalog.jsonb_build_object(
  'openingId',v_opening,'requestId',p_request_id,
  'businessId',p_business_id,'customerId',p_customer_id,
  'moneyOwed',p_amount,'depositHeld',p_deposit,
  'crates',v_normal_crates,'bottles',v_normal_bottles,
  'businessDate',p_business_date
 );
end;
$opening$;
revoke all on function public.record_business_customer_opening(
 uuid,uuid,uuid,integer,integer,date,text,jsonb,jsonb
) from public,anon,authenticated,service_role;
commit;
