-- Allow the existing tenant customer-registration RPC to serve an
-- already-active tenant as well as its setup flow. The function retains
-- owner, business-selection, operational and registration gate checks.
-- It does not grant any direct table write permissions.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $migration$
declare
  v_definition text;
  v_before text := 'and b.status=''setup''';
  v_after text := 'and b.status in (''setup'',''active'')';
  v_occurrences integer;
begin
  select pg_catalog.pg_get_functiondef(
    'public.register_business_customer(uuid,uuid,text,text,text,text)'::regprocedure
  ) into v_definition;

  v_occurrences :=
    (pg_catalog.length(v_definition) -
     pg_catalog.length(pg_catalog.replace(v_definition,v_before,''))) /
     pg_catalog.length(v_before);

  if v_occurrences <> 1 then
    raise exception 'Customer registration status guard drift: expected one setup-only predicate, found %',v_occurrences;
  end if;

  execute pg_catalog.replace(v_definition,v_before,v_after);
end;
$migration$;

commit;
