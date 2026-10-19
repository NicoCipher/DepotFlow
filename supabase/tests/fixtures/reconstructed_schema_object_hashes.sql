-- READ-ONLY per-object digest inventory for a production vs disposable
-- historical SQL reconstruction DIAGNOSTIC. No business data, SQL bodies,
-- credentials or private function definitions are returned.
-- Definition fingerprints are per-object, not SQL text.
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
), audited_objects as (
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
), audited_grouped as (
  select kind,jsonb_object_agg(obj,hash order by obj) as digests
  from (select kind,obj,md5(def) as hash from audited_objects) detail
  group by kind
)
select jsonb_build_object(
 'shape_by_kind',coalesce((select jsonb_object_agg(kind,digests) from audited_grouped),'{}'::jsonb),
 'functions',coalesce((select jsonb_object_agg(obj,hash) from functions),'{}'::jsonb),
 'column_grants',coalesce((select jsonb_object_agg(obj,jsonb_build_object('count',count,'hash',hash)) from grants),'{}'::jsonb)
)::text as fingerprints;
