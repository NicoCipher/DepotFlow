-- Read-only, data-free metadata fingerprint for production vs the exact 121-entry PG17 reconstruction.
-- No row data or SQL definitions are emitted; definitions are reduced to hashes.
WITH relation_rows AS (
 SELECT n.nspname||'.'||c.relname AS obj,
        jsonb_build_object(
          'kind',c.relkind::text,'owner',pg_get_userbyid(c.relowner),
          'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
          'definition_hash',md5(concat_ws('|',c.relkind::text,c.relrowsecurity::text,c.relforcerowsecurity::text,
             coalesce(pg_get_viewdef(c.oid,true),''),coalesce(array_to_string(c.reloptions,','),''))),
          'effective',jsonb_build_object(
            'anon',jsonb_build_object('select',has_table_privilege('anon',c.oid,'SELECT'),'insert',has_table_privilege('anon',c.oid,'INSERT'),'update',has_table_privilege('anon',c.oid,'UPDATE'),'delete',has_table_privilege('anon',c.oid,'DELETE'),'references',has_table_privilege('anon',c.oid,'REFERENCES'),'trigger',has_table_privilege('anon',c.oid,'TRIGGER')),
            'authenticated',jsonb_build_object('select',has_table_privilege('authenticated',c.oid,'SELECT'),'insert',has_table_privilege('authenticated',c.oid,'INSERT'),'update',has_table_privilege('authenticated',c.oid,'UPDATE'),'delete',has_table_privilege('authenticated',c.oid,'DELETE'),'references',has_table_privilege('authenticated',c.oid,'REFERENCES'),'trigger',has_table_privilege('authenticated',c.oid,'TRIGGER')),
            'service_role',jsonb_build_object('select',has_table_privilege('service_role',c.oid,'SELECT'),'insert',has_table_privilege('service_role',c.oid,'INSERT'),'update',has_table_privilege('service_role',c.oid,'UPDATE'),'delete',has_table_privilege('service_role',c.oid,'DELETE'),'references',has_table_privilege('service_role',c.oid,'REFERENCES'),'trigger',has_table_privilege('service_role',c.oid,'TRIGGER'))
          )
        ) AS detail
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','S','f')
), column_rows AS (
 SELECT n.nspname||'.'||c.relname||'.'||a.attname AS obj,
        md5(concat_ws('|',a.atttypid::regtype::text,a.attnotnull::text,coalesce(pg_get_expr(d.adbin,d.adrelid),''),a.attidentity,a.attgenerated,coalesce(coll.collname,''))) AS hash
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 LEFT JOIN pg_collation coll ON coll.oid=a.attcollation
 WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
), constraint_rows AS (
 SELECT n.nspname||'.'||c.relname||'.'||k.conname AS obj,
        md5(concat_ws('|',pg_get_constraintdef(k.oid,true),k.convalidated::text,k.condeferrable::text,k.condeferred::text)) AS hash
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','private')
), index_rows AS (
 SELECT n.nspname||'.'||c.relname||'.'||i.relname AS obj,
        md5(concat_ws('|',pg_get_indexdef(c.oid),ix.indisvalid::text,ix.indisready::text,ix.indislive::text)) AS hash
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_index ix ON ix.indexrelid=c.oid
 JOIN pg_class i ON i.oid=ix.indexrelid WHERE n.nspname IN ('public','private')
), function_rows AS (
 SELECT n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' AS obj,
        jsonb_build_object('definition_hash',md5(pg_get_functiondef(p.oid)),
          'owner',pg_get_userbyid(p.proowner),'security_definer',p.prosecdef,
          'volatility',p.provolatile::text,'config',coalesce(to_jsonb(p.proconfig),'[]'::jsonb),
          'effective_execute',jsonb_build_object('anon',has_function_privilege('anon',p.oid,'EXECUTE'),
            'authenticated',has_function_privilege('authenticated',p.oid,'EXECUTE'),
            'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'))) AS detail
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private')
), policy_rows AS (
 SELECT n.nspname||'.'||c.relname||'.'||p.polname AS obj,
        md5(concat_ws('|',p.polcmd,p.polpermissive::text,
          (SELECT string_agg(coalesce(r.rolname,'PUBLIC'),',' ORDER BY coalesce(r.rolname,'PUBLIC')) FROM unnest(p.polroles) x(role_oid) LEFT JOIN pg_roles r ON r.oid=x.role_oid),
          coalesce(pg_get_expr(p.polqual,p.polrelid,true),''),coalesce(pg_get_expr(p.polwithcheck,p.polrelid,true),''))) AS hash
 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','private')
), trigger_rows AS (
 SELECT n.nspname||'.'||c.relname||'.'||t.tgname AS obj,
        md5(concat_ws('|',pg_get_triggerdef(t.oid,true),t.tgenabled::text,pg_get_userbyid(proc.proowner))) AS hash
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_proc proc ON proc.oid=t.tgfoid WHERE n.nspname IN ('public','private') AND NOT t.tgisinternal
), column_grant_rows AS (
 SELECT table_schema||'.'||table_name AS obj,
        jsonb_agg(jsonb_build_object('column',column_name,'grantee',grantee,'privilege',privilege_type,'grantable',is_grantable) ORDER BY column_name,grantee,privilege_type,is_grantable) AS detail
 FROM information_schema.column_privileges
 WHERE table_schema IN ('public','private') AND grantee IN ('anon','authenticated','service_role')
 GROUP BY table_schema,table_name
), schema_rows AS (
 SELECT n.nspname AS obj,jsonb_build_object('owner',pg_get_userbyid(n.nspowner),
  'anon_usage',has_schema_privilege('anon',n.oid,'USAGE'),'anon_create',has_schema_privilege('anon',n.oid,'CREATE'),
  'authenticated_usage',has_schema_privilege('authenticated',n.oid,'USAGE'),'authenticated_create',has_schema_privilege('authenticated',n.oid,'CREATE'),
  'service_role_usage',has_schema_privilege('service_role',n.oid,'USAGE'),'service_role_create',has_schema_privilege('service_role',n.oid,'CREATE')) AS detail
 FROM pg_namespace n WHERE n.nspname IN ('public','private')
)
SELECT jsonb_build_object(
 'server_version',current_setting('server_version'),
 'relations',coalesce((SELECT jsonb_object_agg(obj,detail ORDER BY obj) FROM relation_rows),'{}'::jsonb),
 'columns',coalesce((SELECT jsonb_object_agg(obj,hash ORDER BY obj) FROM column_rows),'{}'::jsonb),
 'constraints',coalesce((SELECT jsonb_object_agg(obj,hash ORDER BY obj) FROM constraint_rows),'{}'::jsonb),
 'indexes',coalesce((SELECT jsonb_object_agg(obj,hash ORDER BY obj) FROM index_rows),'{}'::jsonb),
 'functions',coalesce((SELECT jsonb_object_agg(obj,detail ORDER BY obj) FROM function_rows),'{}'::jsonb),
 'policies',coalesce((SELECT jsonb_object_agg(obj,hash ORDER BY obj) FROM policy_rows),'{}'::jsonb),
 'triggers',coalesce((SELECT jsonb_object_agg(obj,hash ORDER BY obj) FROM trigger_rows),'{}'::jsonb),
 'column_grants',coalesce((SELECT jsonb_object_agg(obj,detail ORDER BY obj) FROM column_grant_rows),'{}'::jsonb),
 'schemas',coalesce((SELECT jsonb_object_agg(obj,detail ORDER BY obj) FROM schema_rows),'{}'::jsonb)
)::text AS fingerprint;
