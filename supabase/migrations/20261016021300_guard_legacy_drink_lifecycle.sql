-- Integration-only M2d lifecycle security fence.
-- The current main migration introduced set_shop_drink_active() after the
-- original M2 design. Its singleton-owner check is insufficient after
-- membership revocation: the "same result" fast path leaks product state
-- even though a later write would fail in the 29 operational triggers.
--
-- Preserve the latest lifecycle implementation and idempotency behaviour;
-- update only its authentication preamble and fail closed on definition drift.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $guard$
declare
  v_oid oid:='public.set_shop_drink_active(uuid,boolean,boolean)'::regprocedure;
  v_source text;
  v_old text:=E'begin\n  if auth.uid() is null\n'
    ||E'     or not exists (select 1 from private.shop_owner\n'
    ||E'                    where user_id=auth.uid()) then\n'
    ||E'    raise exception using errcode=\'42501\', message=\'Shop owner only\';\n'
    ||'  end if;';
  v_new text;
begin
  if not exists (
    select 1 from pg_catalog.pg_proc p
    where p.oid=v_oid and p.prosecdef
  ) then
    raise exception 'Expected privileged shop lifecycle RPC is missing or altered';
  end if;
  v_source:=pg_catalog.pg_get_functiondef(v_oid);
  if pg_catalog.strpos(v_source,v_old)=0
     or pg_catalog.strpos(
       pg_catalog.substr(v_source,pg_catalog.strpos(v_source,v_old)+1),
       v_old
     )<>0
     or pg_catalog.strpos(v_source,'private.verified_legacy_owner_read()')<>0
  then
    raise exception 'Shop lifecycle authorization changed; manual review required';
  end if;
  v_new:=pg_catalog.replace(v_old,
      E'begin\n  if auth.uid() is null',
      E'begin\n  if not private.verified_legacy_owner_read()\n'
      || '     or auth.uid() is null');
  execute pg_catalog.replace(v_source,v_old,v_new);
end;
$guard$;
commit;
