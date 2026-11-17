-- Tenant activation is a separate, default-off, owner-verified cutover.
begin;
do $test$
declare
  v_def text;
begin
  if not exists (
    select 1 from private.business_activation_gate
    where singleton is true and enabled is false
  ) then
    raise exception 'Activation gate must exist and default OFF';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname='business_opening_activations'
      and c.relrowsecurity
  ) then
    raise exception 'Activation audit table must have RLS enabled';
  end if;
  if has_table_privilege('anon','private.business_opening_activations','SELECT')
     or has_table_privilege('authenticated','private.business_opening_activations','SELECT')
     or has_table_privilege('service_role','private.business_opening_activations','SELECT') then
    raise exception 'Activation audit table must not be directly readable by API roles';
  end if;
  if has_function_privilege('anon',
       'public.activate_business_after_opening_review(uuid,uuid,text)','EXECUTE') then
    raise exception 'Anonymous activation execution must be revoked';
  end if;
  if not has_function_privilege('authenticated',
       'public.activate_business_after_opening_review(uuid,uuid,text)','EXECUTE') then
    raise exception 'Authenticated owner activation RPC grant is missing';
  end if;

  if (select p.provolatile from pg_proc p
      where p.oid='public.can_activate_business(uuid)'::regprocedure) <> 'v'
     or (select p.provolatile from pg_proc p
      where p.oid='public.business_opening_review_status(uuid)'::regprocedure) <> 'v' then
    raise exception 'Owner activation status functions must be volatile because they take row locks';
  end if;

  v_def:=pg_catalog.pg_get_functiondef(
    'public.activate_business_after_opening_review(uuid,uuid,text)'::regprocedure
  );
  if position('private.business_opening_owner_reviews' in v_def)=0
     or position('preview_business_opening_readiness' in v_def)=0
     or position('for update of m,b' in lower(v_def))=0
     or position('operationalEventsBeforeCutover' in v_def)=0
     or position('set status=''active''' in lower(v_def))=0 then
    raise exception 'Activation must lock ownership, recheck review and readiness, reject pre-cutover events, and atomically activate';
  end if;
end;
$test$;
rollback;
