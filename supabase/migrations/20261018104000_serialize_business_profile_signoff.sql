-- M2f-34: serialize sign-off against ordinary business_profiles edits.
-- Existing owner UI may UPDATE business_profiles directly under RLS.
-- Signoff locks that exact profile row BEFORE rereading readiness/token.
-- The lock is held until the immutable review record commits. No grants.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $lock_profile_before_owner_review$
declare
 v_oid oid:=
  'public.confirm_business_opening_review(uuid,uuid,text,text,boolean,boolean,boolean,boolean,boolean)'::regprocedure;
 v_source text;
 v_anchor constant text:=
  ' v_snapshot:=public.preview_business_opening_readiness(p_business_id);';
 v_insert constant text:=$guard$
 -- A direct profile UPDATE takes a conflicting row lock even though it does
 -- not lock private.businesses. Hold a SHARE lock through audit INSERT so
 -- the owner cannot sign a snapshot with stale name/contact details.
 perform 1 from public.business_profiles p
  where p.business_id=p_business_id
  for share;
 if not found then
  raise exception 'Complete the business profile before reviewing'
    using errcode='22023';
 end if;
$guard$;
begin
 v_source:=pg_catalog.pg_get_functiondef(v_oid);
 if v_source is null
  or pg_catalog.strpos(v_source,'private.business_opening_owner_reviews')=0
  or pg_catalog.strpos(v_source,'private.business_opening_review_gate')=0
  or pg_catalog.strpos(v_source,'Complete the business profile before reviewing')<>0
  or (pg_catalog.length(v_source)
    -pg_catalog.length(pg_catalog.replace(v_source,v_anchor,'')))
    /pg_catalog.length(v_anchor)<>1
 then
  raise exception 'Owner sign-off source drift: independent review required';
 end if;
 execute pg_catalog.replace(v_source,v_anchor,v_insert||v_anchor);
end;
$lock_profile_before_owner_review$;
commit;
