-- Rollback-only A/B pricing regression. New-depot costs never inherit
-- Walnik's seeded buying costs; same owner may manage two businesses.
begin;
insert into auth.users(id) values
 ('89c00000-0000-4000-8000-000000000001'),
 ('89c00000-0000-4000-8000-000000000002'),
 ('89c00000-0000-4000-8000-000000000003');
insert into private.shop_owner(user_id)
 values ('89c00000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();
insert into public.product_cost_history(
 id,owner_user_id,catalogue_product_id,cost_price,effective_on
) select '89c00000-0000-4000-9000-000000000030',
 '89c00000-0000-4000-8000-000000000001',id,8600,'2026-10-16'
 from public.product_catalogue where name='Goldberg';

select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
do $validate$
declare r record;n int:=0;
begin
 for r in select ns.nspname s,c.relname t,k.conname
   from pg_constraint k
   join pg_class c on c.oid=k.conrelid
   join pg_namespace ns on ns.oid=c.relnamespace
   join private.legacy_scope_tables() tab
     on tab.schema_name=ns.nspname and tab.table_name=c.relname
   where k.contype='f' and left(k.conname,7)='tenant_'
 loop
   execute format('alter table %I.%I validate constraint %I',r.s,r.t,r.conname);
   n:=n+1;
 end loop;
 if n<>31 then raise exception 'Expected 31 tenant FKs, got %',n;end if;
end;
$validate$;
select private.enable_legacy_write_scope(private.legacy_scope_snapshot());

insert into private.businesses(id,status) values
 ('89c00000-0000-4000-9000-000000000021','setup'),
 ('89c00000-0000-4000-9000-000000000022','active');
-- Same owner legitimately manages two independent businesses.
insert into private.business_memberships(
 business_id,user_id,status,member_kind
) values
 ('89c00000-0000-4000-9000-000000000021',
  '89c00000-0000-4000-8000-000000000002','active','owner'),
 ('89c00000-0000-4000-9000-000000000022',
  '89c00000-0000-4000-8000-000000000002','active','owner');

do $default_off$
begin
 if (select enabled from private.business_cost_history_gate)
    or has_function_privilege('authenticated',
      'public.record_business_buying_cost(uuid,uuid,uuid,integer,date)','EXECUTE')
    or has_function_privilege('anon',
      'public.record_business_buying_cost(uuid,uuid,uuid,integer,date)','EXECUTE') then
   raise exception 'Buying-cost RPC unexpectedly public or enabled';
 end if;
end;
$default_off$;
grant execute on function public.record_business_buying_cost(
 uuid,uuid,uuid,integer,date
) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub','89c00000-0000-4000-8000-000000000002',true);
do $disabled_gate$
declare c uuid;
begin
 select id into c from public.product_catalogue where name='Goldberg';
 begin
  perform public.record_business_buying_cost(
   '89c00000-0000-4000-9000-000000000021',
   '89c00000-0000-4000-9000-000000000041',
   c,9000,'2026-10-18');
  raise exception 'Gate bypassed' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$disabled_gate$;
reset role;
update private.business_cost_history_gate set enabled=true where singleton;

set local role authenticated;
select set_config('request.jwt.claim.sub','89c00000-0000-4000-8000-000000000002',true);
do $a_b_owner$
declare
 c uuid;
 a jsonb;
 b jsonb;
 retry jsonb;
begin
 select id into c from public.product_catalogue where name='Goldberg';
 a:=public.record_business_buying_cost(
  '89c00000-0000-4000-9000-000000000021',
  '89c00000-0000-4000-9000-000000000041',c,9000,'2026-10-18');
 b:=public.record_business_buying_cost(
  '89c00000-0000-4000-9000-000000000022',
  '89c00000-0000-4000-9000-000000000042',c,9000,'2026-10-18');
 if a->>'costPrice'<>'9000' or b->>'costPrice'<>'9000'
    or (a->>'businessId')=(b->>'businessId') then
  raise exception 'A/B duplicate cost amount was incorrectly shared';
 end if;
 retry:=public.record_business_buying_cost(
  '89c00000-0000-4000-9000-000000000021',
  '89c00000-0000-4000-9000-000000000041',c,9000,'2026-10-18');
 if retry is distinct from a then
   raise exception 'Buying-cost uncertain retry not idempotent';
 end if;
 if (select count(*) from public.product_cost_history)<>2
    or (select count(*) from public.product_cost_history where
       business_id='89c00000-0000-4000-9000-000000000021')<>1
    or (select count(*) from public.product_cost_history where
       business_id='89c00000-0000-4000-9000-000000000022')<>1 then
  raise exception 'New owner sees legacy price or incorrect A/B history';
 end if;
 begin
  perform public.record_business_buying_cost(
   '89c00000-0000-4000-9000-000000000021',
   '89c00000-0000-4000-9000-000000000041',c,9200,'2026-10-18');
  raise exception 'Request replay changed recorded quote' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  perform public.record_business_buying_cost(
   '89c00000-0000-4000-9000-000000000021',
   '89c00000-0000-4000-9000-000000000043',c,9000,'2026-10-18');
  raise exception 'Duplicate same-day/same-cost quote created' using errcode='PT001';
 exception when invalid_parameter_value then null;
 end;
 begin
  insert into public.product_cost_history(owner_user_id,catalogue_product_id,
    business_id,cost_price,effective_on)
   values('89c00000-0000-4000-8000-000000000002',c,
      '89c00000-0000-4000-9000-000000000021',1,'2026-10-18');
  raise exception 'Direct cost history DML was granted' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 begin
  update public.product_cost_history set cost_price=0;
  raise exception 'Append-only buying cost was editable' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
end;
$a_b_owner$;
reset role;

-- The original shop can only see the earlier legacy quote; new depot costs
-- are not copied to or mixed with the original pilot's history.
set local role authenticated;
select set_config('request.jwt.claim.sub','89c00000-0000-4000-8000-000000000001',true);
do $legacy_owner$
begin
 if (select count(*) from public.product_cost_history)<>1
    or (select cost_price from public.product_cost_history)<>8600 then
  raise exception 'Legacy owner saw A/B buying prices';
 end if;
end;
$legacy_owner$;
reset role;

-- A nonowner cannot use an exposed RPC merely by knowing a business UUID.
set local role authenticated;
select set_config('request.jwt.claim.sub','89c00000-0000-4000-8000-000000000003',true);
do $intruder$
declare c uuid;
begin
 select id into c from public.product_catalogue where name='Goldberg';
 begin
  perform public.record_business_buying_cost(
   '89c00000-0000-4000-9000-000000000021',
   '89c00000-0000-4000-9000-000000000048',c,9500,'2026-10-18');
  raise exception 'Nonowner inserted shop cost' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 if exists(select 1 from public.product_cost_history) then
  raise exception 'Nonowner read private costs';
 end if;
end;
$intruder$;
reset role;

-- Revoking A does not revoke access to B, even if they share one Auth owner.
update private.business_memberships set status='disabled'
 where business_id='89c00000-0000-4000-9000-000000000021';
set local role authenticated;
select set_config('request.jwt.claim.sub','89c00000-0000-4000-8000-000000000002',true);
do $revoked_a$
declare c uuid;
begin
 select id into c from public.product_catalogue where name='Goldberg';
 if (select count(*) from public.product_cost_history)<>1
    or (select business_id from public.product_cost_history)
       <>'89c00000-0000-4000-9000-000000000022'::uuid then
  raise exception 'Suspended A still visible or B disappeared';
 end if;
 begin
  perform public.record_business_buying_cost(
   '89c00000-0000-4000-9000-000000000021',
   '89c00000-0000-4000-9000-000000000041',c,9000,'2026-10-18');
  raise exception 'Revoked A owner replayed historical price' using errcode='PT001';
 exception when insufficient_privilege then null;
 end;
 if (public.record_business_buying_cost(
  '89c00000-0000-4000-9000-000000000022',
  '89c00000-0000-4000-9000-000000000042',c,9000,'2026-10-18')
  ->>'costPrice')<>'9000' then
  raise exception 'B replay failed after A revoke';
 end if;
end;
$revoked_a$;
reset role;

do $final_history$
begin
 if (select count(*) from public.product_cost_history)<>3 then
  raise exception 'Buying cost history was lost or duplicated';
 end if;
end;
$final_history$;
rollback;
