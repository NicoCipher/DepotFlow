-- Rollback-only: the production-schema fingerprint MUST distinguish an
-- authenticated-only RLS policy from a PUBLIC policy with identical USING.
begin;
create table public.__fingerprint_policy_roles_test(id integer);
alter table public.__fingerprint_policy_roles_test enable row level security;
create policy fingerprint_roles on public.__fingerprint_policy_roles_test
  for select to authenticated using (true);

do $check$
declare
 v_before text;
 v_after text;
begin
 select md5(p.polcmd::text||':'||p.polpermissive::text||':'||
    coalesce(array_to_string(array(
      select case when r.role_oid=0::oid
        then 'PUBLIC' else pg_get_userbyid(r.role_oid) end
      from unnest(p.polroles) as r(role_oid) order by 1
    ),','),'')||':'||
    coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||
    coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
 into v_before
 from pg_policy p
 where p.polrelid='public.__fingerprint_policy_roles_test'::regclass;
 if v_before is null then
   raise exception 'Missing probe policy';
 end if;

 execute 'alter policy fingerprint_roles on public.__fingerprint_policy_roles_test to public';

 select md5(p.polcmd::text||':'||p.polpermissive::text||':'||
    coalesce(array_to_string(array(
      select case when r.role_oid=0::oid
        then 'PUBLIC' else pg_get_userbyid(r.role_oid) end
      from unnest(p.polroles) as r(role_oid) order by 1
    ),','),'')||':'||
    coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||
    coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))
 into v_after
 from pg_policy p
 where p.polrelid='public.__fingerprint_policy_roles_test'::regclass;

 if v_before=v_after or v_after is null then
   raise exception 'PUBLIC vs authenticated policy roles were not fingerprinted';
 end if;
end;
$check$;
rollback;
