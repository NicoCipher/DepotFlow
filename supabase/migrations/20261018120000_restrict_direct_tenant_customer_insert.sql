-- M2f-44: remove the old Data API insert escape hatch for new depots.
-- The new SETUP customer writer is an independently gated SECURITY DEFINER
-- RPC that generates IDs in PostgreSQL. Direct authenticated INSERT of
-- business_id allowed a caller-chosen globally unique customer ID collision
-- oracle; RLS would hide foreign rows but not mask a global PK conflict.
--
-- Preserve original Walnik / legacy customer creation: legacy users still
-- INSERT(id,name,phone,...) WITHOUT business_id. Existing legacy write-scope
-- trigger assigns legacy business_id; customer UPDATE/SELECT unchanged.
-- No activation flags or EXECUTE privileges are enabled.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

revoke insert(business_id) on public.customers from authenticated;

do $verify_customer_create_boundary$
begin
 if has_column_privilege('authenticated','public.customers',
    'business_id','INSERT') then
   raise exception 'Authenticated Data API can still assign business_id';
 end if;
 if not has_column_privilege('authenticated','public.customers',
    'id','INSERT')
  or not has_column_privilege('authenticated','public.customers',
    'name','INSERT')
  or not has_column_privilege('authenticated','public.customers',
    'phone','INSERT')
  or not has_column_privilege('authenticated','public.customers',
    'name','UPDATE') then
   raise exception 'Legacy shop customer create/edit permissions changed';
 end if;
 if has_table_privilege('anon','public.customers','INSERT') then
   raise exception 'Anonymous customer creation is available';
 end if;
 if has_function_privilege('authenticated',
    'public.register_business_customer(uuid,uuid,text,text,text,text)',
    'EXECUTE') then
   raise exception 'New business customer registration RPC exposed before release';
 end if;
end;
$verify_customer_create_boundary$;
commit;
