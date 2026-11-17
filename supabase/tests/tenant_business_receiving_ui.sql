-- The receiving UI gate is owner-scoped and cannot replace the atomic writer.
begin;
do $test$
begin
  if (select p.provolatile from pg_proc p
      where p.oid='public.can_receive_business_stock(uuid)'::regprocedure) <> 'v' then
    raise exception 'Receiving availability must be volatile because it locks membership and business rows';
  end if;
  if has_function_privilege('anon','public.can_receive_business_stock(uuid)','EXECUTE') then
    raise exception 'Anonymous users must not inspect tenant receiving availability';
  end if;
  if not has_function_privilege('authenticated','public.can_receive_business_stock(uuid)','EXECUTE') then
    raise exception 'Authenticated owners need the receiving availability RPC';
  end if;
  if not exists(select 1 from private.business_receiving_gate where singleton is true and enabled is false) then
    raise exception 'Receiving gate must remain default OFF';
  end if;
  if position('private.business_receiving_gate' in pg_catalog.pg_get_functiondef(
      'public.can_receive_business_stock(uuid)'::regprocedure))=0
     or position('private.business_memberships' in pg_catalog.pg_get_functiondef(
      'public.can_receive_business_stock(uuid)'::regprocedure))=0 then
    raise exception 'Receiving availability must check both the tenant owner and release gate';
  end if;
end;
$test$;
rollback;
