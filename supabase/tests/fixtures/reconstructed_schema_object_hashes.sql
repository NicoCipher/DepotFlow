-- READ-ONLY per-object digest inventory for a production vs disposable
-- historical SQL reconstruction DIAGNOSTIC. No business data, SQL bodies,
-- credentials or private function definitions are returned.
with functions as (
 select n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' as obj,
   md5(pg_get_functiondef(p.oid)) as hash
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private')
),
grants as (
 select table_schema||'.'||table_name as obj,
   count(*)::int as count,
   md5(string_agg(column_name||'.'||grantee||'='||privilege_type,
                  E'\n' order by column_name,grantee,privilege_type)) as hash
 from information_schema.column_privileges
 where table_schema in ('public','private')
  and grantee in ('anon','authenticated','service_role')
 group by table_schema,table_name
)
select jsonb_build_object(
 'functions',coalesce((select jsonb_object_agg(obj,hash) from functions),'{}'::jsonb),
 'column_grants',coalesce((select jsonb_object_agg(obj,jsonb_build_object('count',count,'hash',hash)) from grants),'{}'::jsonb)
)::text as fingerprints;
