-- CI-ONLY rehearsal on a PostgreSQL 17 reconstruction of the 55
-- live applied SQL stages. Never point this file at production. It assumes
-- the staged Auth-only migration has just been applied to THIS disposable
-- database, which contains one synthetic previously-existing Auth account.
-- No actual user, credentials, session or customer records are accessed.
begin;
set local lock_timeout='3s';
set local statement_timeout='10s';

do $assert_install$
begin
 if current_setting('server_version_num')::int / 10000 <> 17
 or to_regclass('private.business_auth_signup_gate') is null
 or to_regprocedure('private.depotflow_before_user_created(jsonb)') is null
 or to_regprocedure('private.depotflow_auth_user_insert_guard()') is null
 or (select count(*) from auth.users) <> 1
 or (select count(*) from auth.users
     where id='9a760000-0000-4000-8000-000000000001') <> 1
 or (select count(*) from private.business_auth_signup_gate
     where singleton is true and enabled is false) <> 1
 or not exists(
      select 1 from pg_trigger where
      tgrelid='auth.users'::regclass
      and tgname='depotflow_auth_user_insert_guard'
      and tgenabled in ('O','A')
    )
 or not has_function_privilege('supabase_auth_admin',
      'private.depotflow_before_user_created(jsonb)','EXECUTE')
 or has_function_privilege('authenticated',
      'private.depotflow_before_user_created(jsonb)','EXECUTE')
 or has_function_privilege('anon',
      'private.depotflow_auth_user_insert_guard()','EXECUTE')
 then
   raise exception 'Auth-only historical upgrade preconditions failed';
 end if;
end;
$assert_install$;

-- Emulate the actual GoTrue DB session, NOT merely SET ROLE:
-- trigger intentionally exempts the postgres session_user for maintenance.
set session authorization supabase_auth_admin;
do $closed_insert$
begin
 begin
   insert into auth.users(id) values
    ('9a760000-0000-4000-8000-000000000002');
   raise exception 'Auth signup closed but accepted an INSERT'
      using errcode='PT001';
 exception when insufficient_privilege then
   if sqlerrm <> 'Account registration is not available.' then
      raise exception 'Unexpected closed-gate insert error: %',sqlerrm;
   end if;
 end;
end;
$closed_insert$;
reset session authorization;
do $preserved$
begin
 if (select count(*) from auth.users)<>1 then
   raise exception 'Closed registration modified original account count';
 end if;
end;
$preserved$;

-- Gate activation here is transaction-local to this discarded CI database.
update private.business_auth_signup_gate set enabled=true where singleton;
set session authorization supabase_auth_admin;
insert into auth.users(id) values
 ('9a760000-0000-4000-8000-000000000003');
reset session authorization;

update private.business_auth_signup_gate set enabled=false where singleton;
set session authorization supabase_auth_admin;
do $reclosed_insert$
begin
 begin
   insert into auth.users(id) values
    ('9a760000-0000-4000-8000-000000000004');
   raise exception 'Reclosed Auth gate accepted an INSERT'
      using errcode='PT001';
 exception when insufficient_privilege then
   if sqlerrm <> 'Account registration is not available.' then
      raise exception 'Unexpected reclosed-gate error: %',sqlerrm;
   end if;
 end;
end;
$reclosed_insert$;
reset session authorization;

do $assert_accounts$
begin
 if (select count(*) from auth.users)<>2
  or (select count(*) from auth.users
        where id='9a760000-0000-4000-8000-000000000001')<>1
  or (select count(*) from auth.users
        where id='9a760000-0000-4000-8000-000000000003')<>1
  or (select count(*) from private.business_auth_signup_gate
        where singleton and not enabled)<>1 then
    raise exception 'Historical Auth upgrade corrupted gate or account state';
 end if;
end;
$assert_accounts$;
rollback;
