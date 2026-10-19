-- READ-ONLY PUBLIC/PRIVATE application schema comparison query.
-- Run independently on production (SELECT only) and a disposable clone.
-- Same Postgres major version required for meaningful pg_get_* hashes.
-- No user/business data is fetched or modified.
-- Function fingerprints INCLUDE direct/effective EXECUTE grants and schema USAGE.
-- Does not cover Auth/Storage schemas, extension config, secrets, or data.
with objs as (
  select 'relations' kind, n.nspname||'.'||c.relname obj,
    c.relkind::text||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text as def
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S')
  union all
  select 'columns',n.nspname||'.'||c.relname||'.'||a.attname,
    a.atttypid::regtype::text||':'||a.attnotnull::text||':'||
    coalesce(pg_get_expr(d.adbin,d.adrelid),'')
    from pg_attribute a join pg_class c on c.oid=a.attrelid
    join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where n.nspname in ('public','private') and c.relkind in ('r','p','v','m')
      and a.attnum>0 and not a.attisdropped
  union all
  select 'constraints',n.nspname||'.'||c.relname||'.'||k.conname,
    pg_get_constraintdef(k.oid,true)
    from pg_constraint k join pg_class c on c.oid=k.conrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private')
  union all
  select 'indexes',n.nspname||'.'||c.relname,pg_get_indexdef(c.oid)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind='i'
  union all
  -- Function source alone misses privilege escalation: grant EXECUTE to
  -- PUBLIC/anon/authenticated on SECURITY DEFINER routines. Include direct
  -- ACL, owner, effective role EXECUTE and schema USAGE in the fingerprint.
  select 'functions',n.nspname||'.'||p.oid::regprocedure::text,
    pg_get_functiondef(p.oid)||':owner='||pg_get_userbyid(p.proowner)||
    ':security_definer='||p.prosecdef::text||
    ':direct_acl='||coalesce(p.proacl::text,'DEFAULT_PUBLIC_EXECUTE')||
    ':anon_execute='||has_function_privilege('anon',p.oid,'EXECUTE')::text||
    ':authenticated_execute='||has_function_privilege('authenticated',p.oid,'EXECUTE')::text||
    ':service_role_execute='||has_function_privilege('service_role',p.oid,'EXECUTE')::text||
    ':auth_admin_execute='||has_function_privilege('supabase_auth_admin',p.oid,'EXECUTE')::text||
    ':anon_schema_usage='||has_schema_privilege('anon',n.oid,'USAGE')::text||
    ':authenticated_schema_usage='||has_schema_privilege('authenticated',n.oid,'USAGE')::text||
    ':service_role_schema_usage='||has_schema_privilege('service_role',n.oid,'USAGE')::text||
    ':auth_admin_schema_usage='||has_schema_privilege('supabase_auth_admin',n.oid,'USAGE')::text
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private')
  union all
  select 'policies',n.nspname||'.'||c.relname||'.'||p.polname,
    p.polcmd::text||':'||p.polpermissive::text||':'||
    -- Policy TO-role membership is a security boundary; omit it and a
    -- policy changed from authenticated to PUBLIC hashes identically.
    coalesce(array_to_string(array(
      select case when r.role_oid=0::oid
        then 'PUBLIC' else pg_get_userbyid(r.role_oid) end
      from unnest(p.polroles) as r(role_oid)
      order by 1
    ),','),'')||':'||
    coalesce(pg_get_expr(p.polqual,p.polrelid),'')||':'||
    coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'')
    from pg_policy p join pg_class c on c.oid=p.polrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private')
  union all
  select 'triggers',n.nspname||'.'||c.relname||'.'||t.tgname,
    pg_get_triggerdef(t.oid,true)
    from pg_trigger t join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and not t.tgisinternal
  union all
  select 'column_grants',table_schema||'.'||table_name||'.'||column_name||'.'||grantee,
    privilege_type
    from information_schema.column_privileges
    where table_schema in ('public','private')
      and grantee in ('anon','authenticated','service_role')
)
select kind,count(*)::integer as object_count,
       md5(string_agg(obj||'='||def,E'\n' order by obj,def)) as definition_hash
from objs group by kind order by kind;
