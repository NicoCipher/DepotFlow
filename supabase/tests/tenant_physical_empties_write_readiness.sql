-- M2f-7: disposable PostgreSQL acceptance for same-type bottle inventory.
-- This proves the KEY and RLS, not that nonlegacy checkout/returns are
-- authorized. All fixtures, memberships and extra grants roll back.
begin;

insert into auth.users(id) values
 ('89900000-0000-4000-8000-000000000001'),
 ('89900000-0000-4000-8000-000000000002'),
 ('89900000-0000-4000-8000-000000000003');
insert into private.shop_owner(user_id)
 values('89900000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();

-- Original single shop still has a NULL-tagged empty bottle before activation.
insert into public.empty_bottle_stock(bottle_type,quantity)
values('Goldberg bottle',3);

do $key_contract$
declare v_pk text; v_unique text;
begin
  select pg_catalog.pg_get_constraintdef(c.oid) into v_pk
    from pg_catalog.pg_constraint c
    where c.conrelid='public.empty_bottle_stock'::regclass and c.contype='p';
  select pg_catalog.pg_get_constraintdef(c.oid) into v_unique
    from pg_catalog.pg_constraint c
    where c.conrelid='public.empty_bottle_stock'::regclass
      and c.conname='empty_bottle_stock_business_bottle_unique';
  if v_pk<>'PRIMARY KEY (stock_id)' or
     v_unique<>'UNIQUE NULLS NOT DISTINCT (business_id, bottle_type)' then
    raise exception 'Business-qualified bottle stock key missing: % / %',
      v_pk,v_unique;
  end if;
end
$key_contract$;

-- A second untagged Goldberg stock row is still prohibited (legacy safety).
do $singleton_pre_gate$
declare v_rejected boolean:=false;
begin
  begin
    insert into public.empty_bottle_stock(bottle_type,quantity)
    values('Goldberg bottle',100);
  exception when unique_violation then v_rejected:=true;
  end;
  if not v_rejected then raise exception 'Legacy NULL stock lost uniqueness'; end if;
end
$singleton_pre_gate$;

-- Explicit backfill/validation/activation before provisioning any new depot.
select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate$
declare r record; v_count integer:=0;
begin
  for r in
    select ns.nspname s,cls.relname t,k.conname
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class cls on cls.oid=k.conrelid
    join pg_catalog.pg_namespace ns on ns.oid=cls.relnamespace
    join private.legacy_scope_tables() tab
      on tab.schema_name=ns.nspname and tab.table_name=cls.relname
    where k.contype='f' and pg_catalog.left(k.conname,7)='tenant_'
  loop
    execute pg_catalog.format(
      'alter table %I.%I validate constraint %I',r.s,r.t,r.conname);
    v_count:=v_count+1;
  end loop;
  if v_count<>31 then raise exception 'Tenant FK validation count %',v_count;end if;
end
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

insert into private.businesses(id,status) values
 ('89900000-0000-4000-9000-000000000011','active'),
 ('89900000-0000-4000-9000-000000000012','active');
insert into private.business_memberships(business_id,user_id,member_kind,status) values
 ('89900000-0000-4000-9000-000000000011',
  '89900000-0000-4000-8000-000000000002','owner','active'),
 ('89900000-0000-4000-9000-000000000012',
  '89900000-0000-4000-8000-000000000003','owner','active');

-- Admin-only fixtures; no direct new-business operational write privilege
-- is granted. The real new-shop sale/return RPC is a separate release.
alter table public.empty_bottle_stock disable trigger legacy_scope_business_write;
insert into public.empty_bottle_stock(bottle_type,quantity,business_id) values
 ('Goldberg bottle',4,'89900000-0000-4000-9000-000000000011'),
 ('Goldberg bottle',9,'89900000-0000-4000-9000-000000000012');
alter table public.empty_bottle_stock enable trigger legacy_scope_business_write;

do $three_balances$
begin
  if (select count(*) from public.empty_bottle_stock
      where bottle_type='Goldberg bottle')<>3
   or (select quantity from public.empty_bottle_stock
       where business_id is null and bottle_type='Goldberg bottle') is not null
   or (select quantity from public.empty_bottle_stock
       where business_id='89900000-0000-4000-9000-000000000011')<>4
   or (select quantity from public.empty_bottle_stock
       where business_id='89900000-0000-4000-9000-000000000012')<>9 then
    raise exception 'Independent physical bottle balances were merged';
  end if;
end
$three_balances$;

-- Legacy pilot sees 3, business A sees 4 and business B sees 9.
set local role authenticated;
select set_config('request.jwt.claim.sub',
  '89900000-0000-4000-8000-000000000001',true);
do $legacy$
begin
 if (select count(*) from public.empty_bottle_stock)<>1
  or (select quantity from public.empty_bottle_stock limit 1)<>3 then
   raise exception 'Legacy owner can read foreign Goldberg bottle balances';
 end if;
end
$legacy$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
  '89900000-0000-4000-8000-000000000002',true);
do $owner_a$
begin
 if (select count(*) from public.empty_bottle_stock)<>1
  or (select quantity from public.empty_bottle_stock limit 1)<>4 then
   raise exception 'Business A sees the wrong Goldberg bottle balance';
 end if;
 begin
   insert into public.empty_bottle_stock(
     bottle_type,quantity,business_id
   ) values ('Goldberg bottle',100,'89900000-0000-4000-9000-000000000012');
   raise exception 'New business bypassed staged write prohibition'
     using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end
$owner_a$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
  '89900000-0000-4000-8000-000000000003',true);
do $owner_b$
begin
 if (select count(*) from public.empty_bottle_stock)<>1
  or (select quantity from public.empty_bottle_stock limit 1)<>9 then
   raise exception 'Business B sees the wrong Goldberg bottle balance';
 end if;
end
$owner_b$;
reset role;

-- Immediate membership revocation hides stock without changing historical
-- balances; it is NOT a destructive data transfer between shops.
update private.business_memberships set status='disabled'
where business_id='89900000-0000-4000-9000-000000000011';
set local role authenticated;
select set_config('request.jwt.claim.sub',
  '89900000-0000-4000-8000-000000000002',true);
do $revoked$
begin
 if exists(select 1 from public.empty_bottle_stock) then
   raise exception 'Revoked owner can read physical empty bottles';
 end if;
end
$revoked$;
reset role;

-- No test record or membership can persist in a real business.
rollback;
