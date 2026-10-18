-- M2f-40: owner-only item-level progress for guided physical opening.
-- Returns only already-owned opening markers, including explicit ZERO
-- counts, not unrelated shop stock or private customer finances.
-- NO authenticated/anon EXECUTE grants, gate remains OFF.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function public.preview_business_opening_count_progress(p_business_id uuid)
returns jsonb
language plpgsql volatile security definer set search_path=''
as $progress$
declare
 v_actor uuid:=auth.uid();
 v_total int;
 v_lines jsonb;
begin
 if v_actor is null or p_business_id is null then
  raise exception 'Verified depot owner session required' using errcode='42501';
 end if;
 perform 1 from private.business_memberships m
 join private.businesses b on b.id=m.business_id
 where m.business_id=p_business_id and m.user_id=v_actor
   and m.member_kind='owner' and m.status='active'
   and b.legacy_singleton is null and b.status='setup'
 for share of m,b;
 if not found then
  raise exception 'This depot is unavailable for opening counts'
   using errcode='42501';
 end if;
 perform 1 from private.business_physical_opening_gate
   where enabled is true for share;
 if not found then
  raise exception 'Opening stock counts are not enabled'
   using errcode='42501';
 end if;

 select count(*) into v_total
 from private.business_physical_opening_lines o
 where o.business_id=p_business_id;
 select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'kind',o.kind,'resource',o.resource_key
 ) order by o.kind,o.resource_key),'[]'::jsonb)
 into v_lines from (
  select kind,resource_key
  from private.business_physical_opening_lines
  where business_id=p_business_id
  order by kind,resource_key limit 750
 ) o;
 return pg_catalog.jsonb_build_object(
  'businessId',p_business_id,'count',v_total,
  'truncated',v_total>750,'lines',v_lines,
  'readOnly',true,'canActivate',false
 );
end;
$progress$;
revoke all on function public.preview_business_opening_count_progress(uuid)
 from public,anon,authenticated,service_role;
commit;
