-- M2b contract: a legacy shop backfill must be an explicit, atomic
-- admin operation, never an automatic migration or a new client capability.
-- Disposable PostgreSQL only. All test changes roll back.
begin;

insert into auth.users(id) values
 ('86000000-0000-4000-8000-000000000001'),
 ('86000000-0000-4000-8000-000000000002');
insert into private.shop_owner(user_id)
values ('86000000-0000-4000-8000-000000000001');
select private.link_legacy_shop_business();

insert into public.customers(id,name,phone)
values ('86000000-0000-4000-9000-000000000001','Legacy sample one','860000001'),
       ('86000000-0000-4000-9000-000000000002','Legacy sample two','860000002');

do $m2b$
declare
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
  v_legacy uuid;
  v_message text;
begin
  select id into strict v_legacy from private.businesses
    where legacy_singleton is true;
  v_before := private.legacy_scope_snapshot();
  if (select count(*) from private.legacy_scope_tables()) <> 29
     or (v_before->'public.customers'->>'total')::bigint <> 2
     or (v_before->'public.customers'->>'unassigned')::bigint <> 2
     or (v_before->'public.customers'->>'foreign')::bigint <> 0 then
    raise exception 'M2b preflight does not inventory test data';
  end if;

  -- No business tagging is allowed merely by installing a migration.
  if exists(select 1 from public.customers where business_id is not null) then
    raise exception 'M2b unexpectedly tagged legacy data automatically';
  end if;

  -- Preview drift: a new legacy record after snapshot must prevent backfill.
  insert into public.customers(id,name,phone)
  values ('86000000-0000-4000-9000-000000000003','New test record','860000003');
  begin
    perform private.backfill_legacy_shop_rows(v_before);
    raise exception 'Stale snapshot was accepted' using errcode='PT001';
  exception when SQLSTATE 'P0001' then
    get stacked diagnostics v_message = message_text;
    if v_message not like 'Legacy inventory changed%' then
      raise exception 'Wrong snapshot failure: %',v_message;
    end if;
  end;
  if exists(select 1 from public.customers where business_id is not null) then
    raise exception 'Failed preflight partially tagged customers';
  end if;

  v_before := private.legacy_scope_snapshot();
  v_result := private.backfill_legacy_shop_rows(v_before);
  if (v_result->>'rows_assigned')::bigint < 3 then
    raise exception 'No legacy customer rows were assigned';
  end if;
  if (select count(*) from public.customers
       where business_id=v_legacy) <> 3
     or (select count(*) from public.customers
       where business_id is null) <> 0 then
    raise exception 'Backfill did not exclusively assign the legacy business';
  end if;
  v_after := private.legacy_scope_snapshot();
  if (v_after->'public.customers'->>'unassigned')::bigint <> 0
     or (v_after->'public.customers'->>'legacy')::bigint <> 3 then
    raise exception 'Post-commit inventory is inconsistent';
  end if;

  -- An unchanged retry must not duplicate a business or touch rows again.
  v_result := private.backfill_legacy_shop_rows(v_after);
  if (v_result->>'rows_assigned')::bigint <> 0
     or (select count(*) from private.businesses) <> 1 then
    raise exception 'Idempotent retry modified the legacy shop';
  end if;

  -- Once a second depot exists, NEVER re-label its data as legacy.
  insert into private.businesses(id,status)
  values ('86000000-0000-4000-9000-000000000099','setup');
  update public.customers set business_id=
    '86000000-0000-4000-9000-000000000099'
  where id='86000000-0000-4000-9000-000000000003';
  v_before := private.legacy_scope_snapshot();
  if (v_before->'public.customers'->>'foreign')::bigint <> 1 then
    raise exception 'Foreign business row not detected';
  end if;
  begin
    perform private.backfill_legacy_shop_rows(v_before);
    raise exception 'Cross-depot backfill was accepted' using errcode='PT001';
  exception when SQLSTATE 'P0001' then
    get stacked diagnostics v_message = message_text;
    if v_message not like 'Backfill only supports%' then
      raise exception 'Wrong second-business failure: %',v_message;
    end if;
  end;
  if (select business_id from public.customers
      where id='86000000-0000-4000-9000-000000000003')
     <> '86000000-0000-4000-9000-000000000099'::uuid then
    raise exception 'Another depot was silently relabeled';
  end if;
end;
$m2b$;

do $client_permissions$
begin
  if has_function_privilege('anon','private.legacy_scope_tables()','EXECUTE')
     or has_function_privilege('authenticated','private.legacy_scope_tables()','EXECUTE')
     or has_function_privilege('anon','private.legacy_scope_snapshot()','EXECUTE')
     or has_function_privilege('authenticated','private.legacy_scope_snapshot()','EXECUTE')
     or has_function_privilege('anon','private.backfill_legacy_shop_rows(jsonb)','EXECUTE')
     or has_function_privilege('authenticated','private.backfill_legacy_shop_rows(jsonb)','EXECUTE')
     or has_function_privilege('service_role','private.backfill_legacy_shop_rows(jsonb)','EXECUTE')
     then raise exception 'Administrative backfill function exposed to clients';
  end if;
  if exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='product_catalogue'
    and column_name='business_id') then
    raise exception 'Global product catalogue was tenant tagged';
  end if;
end;
$client_permissions$;

select set_config('request.jwt.claim.sub',
  '86000000-0000-4000-8000-000000000002',true);
set local role authenticated;
do $nonowner$
begin
  if public.is_shop_owner() then
    raise exception 'New identity became legacy shop owner';
  end if;
  begin
    perform private.backfill_legacy_shop_rows('{}'::jsonb);
    raise exception 'Client invoked admin backfill' using errcode='PT001';
  exception when insufficient_privilege then null;
  end;
end;
$nonowner$;
reset role;
rollback;
