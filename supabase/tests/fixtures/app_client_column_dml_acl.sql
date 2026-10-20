-- READ ONLY / no customer data. Exact application-client column DML grant
-- inventory for Supabase hosted PG17 versus 55-stage reconstructed PG17.
-- Includes is_grantable (WITH GRANT OPTION) in every row digest.\n-- DELETE permissions are table-level: check effective access (including\n-- PUBLIC/inherited roles) and delegation on all existing application tables\n-- and updatable views. Exclude only the already-applied stage-56 Auth gate.\n-- Grantor is intentionally excluded: this test verifies effective client\n-- DML permission and delegation, not the full privilege-origin graph.\n-- Intentionally excludes REFERENCES: Supabase-managed references grants can
-- differ from the minimal runner. Do NOT automatically grant privileges to
-- "fix" parity; investigate any SELECT/INSERT/UPDATE/DELETE difference.
with grant_entries as (
 select table_schema||'.'||table_name as obj,
        grantee||':'||privilege_type||':'||column_name||':grantable='||is_grantable as item
 from information_schema.column_privileges
 where table_schema in ('public','private')
   and grantee in ('anon','authenticated','service_role')
   and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
), per_table as (
 select obj,count(*)::int grant_count,
        md5(string_agg(item,E'\n' order by item)) hash
 from grant_entries group by obj
), effective_delete as (
 -- Column-level grants CANNOT include DELETE. Use the effective Postgres
 -- privilege engine, not just explicit table_privileges rows: this detects
 -- role inheritance and privileges granted to PUBLIC. Check grant-option
 -- state for each role as well. An Auth-only gate table is excluded because
 -- it is already installed in hosted stage 56, while this comparison runs
 -- on the 55-stage historical reconstruction.
 select n.nspname||'.'||c.relname as obj, role_name,
        has_table_privilege(role_name,c.oid,'DELETE') as can_delete,
        has_table_privilege(role_name,c.oid,'DELETE WITH GRANT OPTION') as can_delegate_delete
 from pg_class c
 join pg_namespace n on n.oid=c.relnamespace
 cross join (values ('anon'),('authenticated'),('service_role')) roles(role_name)
 where n.nspname in ('public','private') and c.relkind in ('r','p','v')
   and not (n.nspname='private' and c.relname='business_auth_signup_gate')
), per_table_delete as (
 select obj,
        jsonb_object_agg(role_name,jsonb_build_object(
            'delete',can_delete,
            'grant_option',can_delegate_delete
        ) order by role_name) as roles
 from effective_delete group by obj
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
 'per_table',coalesce((select jsonb_object_agg(obj,jsonb_build_object('count',grant_count,'hash',hash)) from per_table),'{}'::jsonb),
 'effective_delete_by_table',coalesce((select jsonb_object_agg(obj,roles) from per_table_delete),'{}'::jsonb)
)::text as fingerprint;
