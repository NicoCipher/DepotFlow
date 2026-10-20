-- Rollback-only M2 new-depot crate count tests. Branded crate types are
-- exact UUID identities; same-sized Gulder and Heineken do not substitute.
begin;

insert into auth.users(id) values
 ('89b00000-0000-4000-8000-000000000001'),
 ('89b00000-0000-4000-8000-000000000002'),
 ('89b00000-0000-4000-8000-000000000003');
insert into private.shop_owner(user_id)
 values('89b00000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
insert into public.crate_types(id,name,empty_family,pocket_count)
values ('89b00000-0000-4000-9000-000000000010','Legacy Heineken','NBL',12);
insert into public.empty_crate_stock(crate_type_id,quantity)
values('89b00000-0000-4000-9000-000000000010',1);

select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate$
declare r record;n int:=0;
begin
 for r in
  select ns.nspname s,c.relname t,k.conname
  from pg_constraint k join pg_class c on c.oid=k.conrelid
  join pg_namespace ns on ns.oid=c.relnamespace
  join private.legacy_scope_tables() tab
    on tab.schema_name=ns.nspname and tab.table_name=c.relname
  where k.contype='f' and left(k.conname,7)='tenant_'
 loop
  execute format('alter table %I.%I validate constraint %I',r.s,r.t,r.conname);
  n:=n+1;
 end loop;
 if n<>31 then raise exception 'Missing tenant FKs: %',n;end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

insert into private.businesses(id,status) values
 ('89b00000-0000-4000-9000-000000000021','setup'),
 ('89b00000-0000-4000-9000-000000000022','active');
insert into private.business_memberships(business_id,user_id,status,member_kind)
values
 ('89b00000-0000-4000-9000-000000000021',
  '89b00000-0000-4000-8000-000000000002','active','owner'),
 ('89b00000-0000-4000-9000-000000000022',
  '89b00000-0000-4000-8000-000000000003','active','owner');

-- Crate type enrollment is NOT enabled for new shops. Seed two distinct
-- 12-pocket A types and one B type as admin in the disposable fixture only.
alter table public.crate_types disable trigger legacy_scope_business_write;
insert into public.crate_types(id,name,empty_family,pocket_count,business_id)
values
 ('89b00000-0000-4000-9000-000000000031','A Heineken 12','NBL',12,
  '89b00000-0000-4000-9000-000000000021'),
 ('89b00000-0000-4000-9000-000000000032','A Gulder 12','NBL',12,
  '89b00000-0000-4000-9000-000000000021'),
 ('89b00000-0000-4000-9000-000000000033','B Gulder 12','NBL',12,
  '89b00000-0000-4000-9000-000000000022');
alter table public.crate_types enable trigger legacy_scope_business_write;

do $guarded_default$
begin
 if (select enabled from private.business_crate_count_gate)
  or has_function_privilege('authenticated',
      'public.count_business_empty_crates(uuid,uuid,uuid,integer,integer,date)','EXECUTE')
  or has_function_privilege('anon',
      'public.count_business_empty_crates(uuid,uuid,uuid,integer,integer,date)','EXECUTE') then
   raise exception 'Crate count unexpectedly activated for public users';
 end if;
end;
$guarded_default$;
grant execute on function public.count_business_empty_crates(
 uuid,uuid,uuid,integer,integer,date
) to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89b00000-0000-4000-8000-000000000002',true);
do $disabled$
begin
 begin
  perform public.count_business_empty_crates(
    '89b00000-0000-4000-9000-000000000021',
    '89b00000-0000-4000-9000-000000000101',
    '89b00000-0000-4000-9000-000000000031',
    3,0,'2026-10-17');
  raise exception 'Crate stock writer bypassed disabled rollout gate'
   using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$disabled$;
reset role;

update private.business_crate_count_gate set enabled=true where singleton;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89b00000-0000-4000-8000-000000000002',true);
do $a_counts$
declare a jsonb; r jsonb;
begin
 a:=public.count_business_empty_crates(
  '89b00000-0000-4000-9000-000000000021',
  '89b00000-0000-4000-9000-000000000101',
  '89b00000-0000-4000-9000-000000000031',
  3,0,'2026-10-17');
 r:=public.count_business_empty_crates(
  '89b00000-0000-4000-9000-000000000021',
  '89b00000-0000-4000-9000-000000000101',
  '89b00000-0000-4000-9000-000000000031',
  3,0,'2026-10-17');
 if r is distinct from a or (a->>'quantity')::int<>3 then
  raise exception 'Original Heineken count replay changed: % / %',a,r;
 end if;
 perform public.count_business_empty_crates(
  '89b00000-0000-4000-9000-000000000021',
  '89b00000-0000-4000-9000-000000000102',
  '89b00000-0000-4000-9000-000000000032',
  2,0,'2026-10-17');
 if (select count(*) from public.empty_crate_stock)<>2
  or (select count(*) from public.empty_crate_stock where quantity=3)<>1
  or (select count(*) from public.empty_crate_stock where quantity=2)<>1 then
   raise exception 'A must see its own two branded crate balances';
 end if;
 begin
   perform public.count_business_empty_crates(
    '89b00000-0000-4000-9000-000000000021',
    '89b00000-0000-4000-9000-000000000103',
    '89b00000-0000-4000-9000-000000000033',
    9,0,'2026-10-17');
   raise exception 'A counted foreign business crate identity'
    using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
end;
$a_counts$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89b00000-0000-4000-8000-000000000003',true);
do $b_counts$
begin
 perform public.count_business_empty_crates(
  '89b00000-0000-4000-9000-000000000022',
  '89b00000-0000-4000-9000-000000000201',
  '89b00000-0000-4000-9000-000000000033',
  7,0,'2026-10-17');
 if (select count(*) from public.empty_crate_stock)<>1
  or (select quantity from public.empty_crate_stock)<>7 then
   raise exception 'B must only see its own seven Gulder crates';
 end if;
end;
$b_counts$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89b00000-0000-4000-8000-000000000002',true);
do $stale_and_tampering$
declare x jsonb;
begin
 x:=public.count_business_empty_crates(
  '89b00000-0000-4000-9000-000000000021',
  '89b00000-0000-4000-9000-000000000104',
  '89b00000-0000-4000-9000-000000000031',
  4,3,'2026-10-17');
 if (x->>'previous')::int<>3 then raise exception 'Incorrect previous crate count';end if;
 begin
  perform public.count_business_empty_crates(
   '89b00000-0000-4000-9000-000000000021',
   '89b00000-0000-4000-9000-000000000105',
   '89b00000-0000-4000-9000-000000000031',
   100,3,'2026-10-17');
  raise exception 'Stale Heineken count overwritten' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.count_business_empty_crates(
   '89b00000-0000-4000-9000-000000000021',
   '89b00000-0000-4000-9000-000000000104',
   '89b00000-0000-4000-9000-000000000032',
   4,3,'2026-10-17');
  raise exception 'Reused request with a different branded crate identity'
   using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
end;
$stale_and_tampering$;
reset role;

do $integrity$
begin
 if (select count(*) from public.empty_crate_stock)<>4
   or (select quantity from public.empty_crate_stock
        where crate_type_id='89b00000-0000-4000-9000-000000000010')<>1
   or (select quantity from public.empty_crate_stock
        where crate_type_id='89b00000-0000-4000-9000-000000000031')<>4
   or (select quantity from public.empty_crate_stock
        where crate_type_id='89b00000-0000-4000-9000-000000000032')<>2
   or (select quantity from public.empty_crate_stock
        where crate_type_id='89b00000-0000-4000-9000-000000000033')<>7
   or (select count(*) from private.business_empty_crate_counts)<>4 then
    raise exception 'Branded physical crate counts lost isolation or audit';
 end if;
end;
$integrity$;

update private.business_memberships set status='disabled'
where business_id='89b00000-0000-4000-9000-000000000022';
set local role authenticated;
select set_config('request.jwt.claim.sub',
 '89b00000-0000-4000-8000-000000000003',true);
do $revoked$
begin
 begin
  perform public.count_business_empty_crates(
   '89b00000-0000-4000-9000-000000000022',
   '89b00000-0000-4000-9000-000000000201',
   '89b00000-0000-4000-9000-000000000033',
   7,0,'2026-10-17');
  raise exception 'Revoked B replayed an old crate count'
   using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 if exists(select 1 from public.empty_crate_stock) then
  raise exception 'Revoked B can read physical crate inventory';
 end if;
end;
$revoked$;
reset role;

rollback;
