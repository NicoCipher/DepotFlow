-- M2f-41: keep a newly registered depot's ORIGINAL (name,location)
-- reserved even when the editable public profile later moves or changes.
-- This complements the current-profile normalized unique index and the
-- nonblank registered-location trigger. Neither protects past identities
-- after a legitimate nonblank profile update.
-- Additive and fail-closed: pre-existing ambiguous duplicates abort migration.
-- NO new grants, release-gate changes or live record mutations.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- business_registration_requests is already one immutable private
-- successful request per business, uniquely keyed by business_id.
-- A new registration writes this record as its LAST SQL operation,
-- inside the SAME transaction as business, owner and current profile.
-- This index therefore also serializes simultaneous ownership claims for
-- the same originally registered physical identity across different users.
create unique index business_registration_original_location_unique
on private.business_registration_requests (
  pg_catalog.lower(pg_catalog.btrim(
    pg_catalog.regexp_replace(business_name,'[[:space:]]+',' ','g')
  )),
  pg_catalog.lower(pg_catalog.btrim(
    pg_catalog.regexp_replace(business_address,'[[:space:]]+',' ','g')
  ))
);

-- Never make this original reservation client-editable. The original
-- request table has no anon/authenticated grants and has RLS enabled.
do $verify_reservation_privileges$
begin
 if has_table_privilege('anon',
    'private.business_registration_requests','UPDATE, DELETE')
  or has_table_privilege('authenticated',
    'private.business_registration_requests','UPDATE, DELETE')
 then
  raise exception 'Original depot identity reservation must not be editable';
 end if;
end;
$verify_reservation_privileges$;
commit;
