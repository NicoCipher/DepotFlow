-- Tenant owner RPC grants are authenticated-only and remain behind gates.
begin;
do $test$
declare
  v_function regprocedure;
  v_definition text;
  v_functions regprocedure[] := array[
    'public.confirm_business_opening_review(uuid,uuid,text,text,boolean,boolean,boolean,boolean,boolean)'::regprocedure,
    'public.count_business_empty_bottles(uuid,uuid,text,integer,integer,date)'::regprocedure,
    'public.count_business_empty_crates(uuid,uuid,uuid,integer,integer,date)'::regprocedure,
    'public.count_business_product_stock(uuid,uuid,uuid,numeric,integer,integer,integer,date)'::regprocedure,
    'public.prepare_business_opening_review(uuid)'::regprocedure,
    'public.preview_business_opening_count_progress(uuid)'::regprocedure,
    'public.preview_business_opening_readiness(uuid)'::regprocedure,
    'public.receive_business_stock(uuid,uuid,uuid,numeric,integer,integer,integer,uuid,date)'::regprocedure,
    'public.record_business_buying_cost(uuid,uuid,uuid,integer,date)'::regprocedure,
    'public.record_business_customer_opening(uuid,uuid,uuid,integer,integer,date,text,jsonb,jsonb)'::regprocedure,
    'public.record_business_physical_opening(uuid,uuid,text,text,integer,integer,integer,date)'::regprocedure,
    'public.register_business_customer(uuid,uuid,text,text,text,text)'::regprocedure
  ];
begin
  foreach v_function in array v_functions loop
    if not has_function_privilege('authenticated',v_function,'EXECUTE') then
      raise exception 'Authenticated execute grant missing for %',v_function;
    end if;
    if has_function_privilege('anon',v_function,'EXECUTE') then
      raise exception 'Anonymous execute must remain revoked for %',v_function;
    end if;
    select pg_catalog.pg_get_functiondef(v_function) into v_definition;
    if not (select p.prosecdef and p.provolatile='v'
        and p.proconfig @> array['search_path=""']
        from pg_proc p where p.oid=v_function) then
      raise exception 'Tenant RPC must be SECURITY DEFINER, volatile and search_path empty: %',v_function;
    end if;
    if position('auth.uid' in lower(v_definition))=0
       or position('business_memberships' in lower(v_definition))=0
       or position('_gate' in lower(v_definition))=0
       or position('legacy_singleton' in lower(v_definition))=0 then
      raise exception 'Tenant RPC owner, gate or non-legacy checks missing: %',v_function;
    end if;
  end loop;
  if exists (
    select 1 from (values
      ('business_assortment_setup_gate'),('business_auth_signup_gate'),
      ('business_bottle_count_gate'),('business_cost_history_gate'),
      ('business_crate_count_gate'),('business_customer_opening_gate'),
      ('business_customer_payment_gate'),('business_customer_registration_gate'),
      ('business_opening_readiness_gate'),('business_opening_review_gate'),
      ('business_physical_opening_gate'),('business_product_stock_count_gate'),
      ('business_receiving_gate'),('business_registration_gate'),
      ('business_sales_gate'),('business_selection_gate')
    ) as gates(table_name)
    where exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='private' and c.relname=gates.table_name
    )
    and case gates.table_name
      when 'business_assortment_setup_gate' then (select enabled from private.business_assortment_setup_gate where singleton)
      when 'business_auth_signup_gate' then (select enabled from private.business_auth_signup_gate where singleton)
      when 'business_bottle_count_gate' then (select enabled from private.business_bottle_count_gate where singleton)
      when 'business_cost_history_gate' then (select enabled from private.business_cost_history_gate where singleton)
      when 'business_crate_count_gate' then (select enabled from private.business_crate_count_gate where singleton)
      when 'business_customer_opening_gate' then (select enabled from private.business_customer_opening_gate where singleton)
      when 'business_customer_payment_gate' then (select enabled from private.business_customer_payment_gate where singleton)
      when 'business_customer_registration_gate' then (select enabled from private.business_customer_registration_gate where singleton)
      when 'business_opening_readiness_gate' then (select enabled from private.business_opening_readiness_gate where singleton)
      when 'business_opening_review_gate' then (select enabled from private.business_opening_review_gate where singleton)
      when 'business_physical_opening_gate' then (select enabled from private.business_physical_opening_gate where singleton)
      when 'business_product_stock_count_gate' then (select enabled from private.business_product_stock_count_gate where singleton)
      when 'business_receiving_gate' then (select enabled from private.business_receiving_gate where singleton)
      when 'business_registration_gate' then (select enabled from private.business_registration_gate where singleton)
      when 'business_sales_gate' then (select enabled from private.business_sales_gate where singleton)
      when 'business_selection_gate' then (select enabled from private.business_selection_gate where singleton)
      else false
    end
  ) then
    raise exception 'A business feature gate unexpectedly opened during the rehearsal';
  end if;
end;
$test$;
rollback;
