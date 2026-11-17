-- Active tenant customer registration remains owner-scoped and gated.
begin;
do $test$
declare
  v_def text;
begin
  v_def:=pg_catalog.pg_get_functiondef(
    'public.register_business_customer(uuid,uuid,text,text,text,text)'::regprocedure
  );
  if position('b.status in (''setup'',''active'')' in v_def)=0 then
    raise exception 'Tenant customer registration must accept setup and active businesses';
  end if;
  if position('business_customer_registration_gate' in v_def)=0
     or position('business_selection_gate' in v_def)=0
     or position('legacy_write_scope_gate' in v_def)=0 then
    raise exception 'Active customer registration must retain all existing release and legacy-scope gates';
  end if;
  if has_function_privilege('anon',
      'public.register_business_customer(uuid,uuid,text,text,text,text)','EXECUTE') then
    raise exception 'Anonymous customer registration must remain revoked';
  end if;
  if not has_function_privilege('authenticated',
      'public.register_business_customer(uuid,uuid,text,text,text,text)','EXECUTE') then
    raise exception 'Authenticated owner customer registration grant is missing';
  end if;
  if not exists(select 1 from private.business_customer_registration_gate
      where singleton is true and enabled is false) then
    raise exception 'Customer registration gate must remain default OFF';
  end if;
end;
$test$;
rollback;
