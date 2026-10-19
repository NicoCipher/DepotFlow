-- READ ONLY / no customer data. Exact application-client column DML grant
-- inventory for Supabase hosted PG17 versus 55-stage reconstructed PG17.
-- Intentionally excludes REFERENCES: Supabase-managed references grants can
-- differ from the minimal runner. Do NOT automatically grant privileges to
-- "fix" parity; investigate any SELECT/INSERT/UPDATE/DELETE difference.
with grant_entries as (
 select table_schema||'.'||table_name as obj,
        grantee||':'||privilege_type||':'||column_name as item
 from information_schema.column_privileges
 where table_schema in ('public','private')
   and grantee in ('anon','authenticated','service_role')
   and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
), per_table as (
 select obj,count(*)::int grant_count,
        md5(string_agg(item,E'\n' order by item)) hash
 from grant_entries group by obj
), counts as (
 select grantee||':'||privilege_type role_privilege,count(*)::int grant_count
 from information_schema.column_privileges
 where table_schema in ('public','private')
   and grantee in ('anon','authenticated','service_role')
   and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
 group by grantee,privilege_type
)
select jsonb_build_object(
 'counts_by_role_and_privilege',coalesce((select jsonb_object_agg(role_privilege,grant_count) from counts),'{}'::jsonb),
 'per_table',coalesce((select jsonb_object_agg(obj,jsonb_build_object('count',grant_count,'hash',hash)) from per_table),'{}'::jsonb)
)::text as fingerprint;
