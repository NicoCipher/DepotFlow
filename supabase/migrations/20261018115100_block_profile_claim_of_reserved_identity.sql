-- M2f-42: present profile + immutable original registration identity
-- must obey the SAME global ownership boundary.
-- A business can relocate but another business cannot later edit its
-- profile to claim that business's originally registered address.
-- No tenant grants changed; pre-existing global profile uniqueness remains.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function private.reject_blank_registered_depot_identity()
returns trigger
language plpgsql security definer set search_path=''
as $guard$
declare
 v_name text;
 v_address text;
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

 -- The original registered identity is an immutable private reservation.
 -- Check it on ALL editable profile changes, even when the registering
 -- business now operates elsewhere. Current-profile UNIQUE alone does not
 -- protect identities whose original address has since changed.
 if new.name is not null and new.address is not null
   and pg_catalog.btrim(new.name)<>'' and pg_catalog.btrim(new.address)<>'' then
   v_name:=pg_catalog.lower(pg_catalog.btrim(
     pg_catalog.regexp_replace(new.name,'[[:space:]]+',' ','g')));
   v_address:=pg_catalog.lower(pg_catalog.btrim(
     pg_catalog.regexp_replace(new.address,'[[:space:]]+',' ','g')));
   if exists(
     select 1 from private.business_registration_requests r
     where r.business_id<>new.business_id
       and pg_catalog.lower(pg_catalog.btrim(
         pg_catalog.regexp_replace(r.business_name,'[[:space:]]+',' ','g')
       ))=v_name
       and pg_catalog.lower(pg_catalog.btrim(
         pg_catalog.regexp_replace(r.business_address,'[[:space:]]+',' ','g')
       ))=v_address
   ) then
     raise exception 'This business name and location is already registered'
       using errcode='22023';
   end if;
 end if;

 return new;
end;
$guard$;
revoke all on function private.reject_blank_registered_depot_identity()
 from public,anon,authenticated,service_role;
commit;
