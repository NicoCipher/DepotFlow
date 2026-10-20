-- M2f-39: prevent a registered depot from releasing its reserved
-- normalized physical identity simply by clearing editable profile fields.
-- Existing legacy/placeholder profiles are unaffected.
-- Direct profile updates remain allowed for nonblank name and location.
-- Default rollout gates and privileges are unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function private.reject_blank_registered_depot_identity()
returns trigger
language plpgsql security definer set search_path=''
as $guard$
begin
 if exists(
  select 1 from private.business_registration_requests r
  where r.business_id=new.business_id
 ) and (
    new.name is null or pg_catalog.btrim(new.name)=''
    or new.address is null or pg_catalog.btrim(new.address)=''
 ) then
  raise exception
   'Registered depots must keep a nonblank business name and physical location'
   using errcode='22023';
 end if;
 return new;
end;
$guard$;
revoke all on function private.reject_blank_registered_depot_identity()
  from public,anon,authenticated,service_role;

-- A trigger, not a caller-owned validation: a direct owner UPDATE of
-- public.business_profiles must pass this rule as well.
create trigger preserve_registered_depot_location
before update of name,address on public.business_profiles
for each row
execute function private.reject_blank_registered_depot_identity();

commit;
