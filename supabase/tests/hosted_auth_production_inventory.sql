-- DepotFlow hosted Auth deployment inventory.
-- SELECT-ONLY, including on a database where the hook/gate is absent.
-- Save output privately BEFORE installation and compare after installation.
-- This does not verify GoTrue's separate managed Auth-hook configuration.
select jsonb_build_object(
 'postgres_major',current_setting('server_version_num')::int/10000,
 'existing_auth_accounts',(select count(*) from auth.users),
 'auth_table_owner',(select pg_get_userbyid(relowner)
                       from pg_class where oid='auth.users'::regclass),
 'auth_trigger_names',(select coalesce(jsonb_agg(tgname order by tgname),'[]'::jsonb)
                       from pg_trigger
                       where tgrelid='auth.users'::regclass and not tgisinternal),
 'auth_admin_role_exists',exists(select 1 from pg_roles
                                    where rolname='supabase_auth_admin'),
 'signup_gate_installed',
   to_regclass('private.business_auth_signup_gate') is not null,
 'signup_hook_function_installed',
   to_regprocedure('private.depotflow_before_user_created(jsonb)') is not null,
 'signup_insert_guard_function_installed',
   to_regprocedure('private.depotflow_auth_user_insert_guard()') is not null,
 'signup_insert_guard_trigger_active',
   exists(select 1 from pg_trigger
          where tgrelid='auth.users'::regclass
            and tgname='depotflow_auth_user_insert_guard'
            and tgenabled in ('O','A')),
 'anon_can_call_hook',coalesce(
   has_function_privilege('anon',
      to_regprocedure('private.depotflow_before_user_created(jsonb)'),'EXECUTE'),
   false),
 'authenticated_can_call_hook',coalesce(
   has_function_privilege('authenticated',
      to_regprocedure('private.depotflow_before_user_created(jsonb)'),'EXECUTE'),
   false),
 'auth_admin_can_call_hook',coalesce(
   has_function_privilege('supabase_auth_admin',
      to_regprocedure('private.depotflow_before_user_created(jsonb)'),'EXECUTE'),
   false),
 'anon_can_call_guard',coalesce(
   has_function_privilege('anon',
      to_regprocedure('private.depotflow_auth_user_insert_guard()'),'EXECUTE'),
   false),
 'authenticated_can_call_guard',coalesce(
   has_function_privilege('authenticated',
      to_regprocedure('private.depotflow_auth_user_insert_guard()'),'EXECUTE'),
   false),
 'managed_auth_hook_configured','CANNOT_BE_INFERRED_FROM_POSTGRES',
 'release_approved',false
) as auth_deployment_inventory;
