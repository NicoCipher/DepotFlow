-- Read-only function metadata parity for the current production schema.
-- Function bodies are checked separately; this captures owner, security mode,
-- direct ACL and effective execution/schema privileges for every public/private function.
with function_meta as (
  select
    n.nspname || '.' || p.oid::regprocedure::text as object_name,
    jsonb_build_object(
      'owner', pg_get_userbyid(p.proowner),
      'security_definer', p.prosecdef,
      'direct_acl', coalesce(p.proacl::text, 'DEFAULT'),
      'proconfig', p.proconfig,
      'provolatile', p.provolatile,
      'prokind', p.prokind,
      'proretset', p.proretset,
      'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'service_role_execute', has_function_privilege('service_role', p.oid, 'EXECUTE'),
      'supabase_auth_admin_execute', has_function_privilege('supabase_auth_admin', p.oid, 'EXECUTE'),
      'anon_schema_usage', has_schema_privilege('anon', n.oid, 'USAGE'),
      'authenticated_schema_usage', has_schema_privilege('authenticated', n.oid, 'USAGE'),
      'service_role_schema_usage', has_schema_privilege('service_role', n.oid, 'USAGE'),
      'supabase_auth_admin_schema_usage', has_schema_privilege('supabase_auth_admin', n.oid, 'USAGE')
    ) as metadata
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'private')
)
select jsonb_build_object(
  'function_count', (select count(*) from function_meta),
  'function_metadata', (select jsonb_object_agg(object_name, metadata order by object_name) from function_meta),
  'normalized_legacy_record_payment_hash',
    case
      when to_regprocedure('private.record_payment(uuid,uuid,numeric,date)') is null then null
      else md5(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              pg_get_functiondef(to_regprocedure('private.record_payment(uuid,uuid,numeric,date)')),
              E'/\\*.*?\\*/', '', 'gs'
            ),
            E'--[^\\r\\n]*', '', 'g'
          ),
          E'\\s+', ' ', 'g'
        )
      )
    end
)::text as fingerprint;
