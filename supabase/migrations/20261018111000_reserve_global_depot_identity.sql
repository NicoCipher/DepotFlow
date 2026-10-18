-- M2f-37: cross-owner reservation of the same named physical location.
-- Never auto-transfer a contested existing depot to another account.
-- If historic rows conflict, the migration FAILS; investigate and resolve
-- ownership before any real onboarding grant or rollout.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- An empty location cannot establish an identity. Public profile editing
-- may still keep legacy/old placeholder addresses empty, but a newly
-- registered official depot must supply an actual location.
-- UNIQUE expression index protects both the registration RPC INSERT and
-- ordinary tenant-authorized business_profiles UPDATE, across owners.
create unique index business_profiles_global_named_location_unique
on public.business_profiles (
  pg_catalog.lower(pg_catalog.btrim(
    pg_catalog.regexp_replace(name,'[[:space:]]+',' ','g')
  )),
  pg_catalog.lower(pg_catalog.btrim(
    pg_catalog.regexp_replace(address,'[[:space:]]+',' ','g')
  ))
)
where pg_catalog.btrim(address)<>'';

-- Normalized case/whitespace identity is intentionally coarser than legal
-- ownership; an actual co-located separate business can be examined through
-- a later documented claim/review process. For now conflicts fail closed.
commit;
