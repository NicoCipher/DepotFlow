-- The configured Supabase Auth service role can only create users when
-- the separate database gate is enabled. Rollback-only simulation; does NOT
-- turn on the actual Auth hook in any project.
begin;
do $grants$
begin
 if not exists (
   select 1 from pg_catalog.pg_trigger t
   where t.tgrelid='auth.users'::regclass
     and t.tgname='depotflow_auth_user_insert_guard'
     and t.tgenabled='O' and not t.tgisinternal
 )
 or has_function_privilege('anon',
   'private.depotflow_auth_user_insert_guard()','EXECUTE')
 or has_function_privilege('authenticated',
   'private.depotflow_auth_user_insert_guard()','EXECUTE')
 then
   raise exception 'Transaction-level auth.users creation fence missing or exposed';
 end if;
 if (select enabled from private.business_auth_signup_gate)
   or has_function_privilege('anon',
     'private.depotflow_before_user_created(jsonb)','EXECUTE')
   or has_function_privilege('authenticated',
     'private.depotflow_before_user_created(jsonb)','EXECUTE')
   or not has_function_privilege('supabase_auth_admin',
     'private.depotflow_before_user_created(jsonb)','EXECUTE')
 then
  raise exception 'Auth hook exposure/default state invalid';
 end if;
end;
$grants$;

set local role supabase_auth_admin;
do $disabled$
declare v jsonb;
begin
 v:=private.depotflow_before_user_created(
  '{"user":{"email":"new-owner@example.com"}}'::jsonb
 );
 if v->'error'->>'http_code'<>'403' then
  raise exception 'Disabled Auth gate allowed direct signup: %',v;
 end if;
end;
$disabled$;
reset role;

update private.business_auth_signup_gate
 set enabled=true where singleton is true;
set local role supabase_auth_admin;
do $enabled_and_invalid_payload$
declare v jsonb;
begin
 v:=private.depotflow_before_user_created(
  '{"user":{"email":"real-owner@example.com"}}'::jsonb
 );
 if v is distinct from '{}'::jsonb then
  raise exception 'Enabled and valid Auth payload unexpectedly denied';
 end if;
 for v in
  select private.depotflow_before_user_created(payload)
  from (values ('{}'::jsonb),
      ('{"user":{"email":"garbage"}}'::jsonb),
      ('{"user":{"email":" "}}'::jsonb),
      ('{"user":null}'::jsonb),
      ('null'::jsonb)) p(payload)
 loop
  if v->'error'->>'http_code'<>'403' then
   raise exception 'Malformed/Authless payload allowed signup: %',v;
  end if;
 end loop;
end;
$enabled_and_invalid_payload$;
reset role;
rollback;
