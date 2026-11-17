-- Applied production migration 20261117100429 (enable_walnik_onboarding_gates).
-- Opens only the owner-verified Walnik setup/review path. The gates are
-- global, but RPCs still require an authenticated active owner membership
-- for the requested non-legacy tenant. No data rows are created or changed.
-- Sales, debt payments, receiving, public signup, business registration and
-- cost-history editing deliberately remain disabled.

begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

update private.business_selection_gate set enabled=true where singleton is true;
update private.business_assortment_setup_gate set enabled=true where singleton is true;
update private.business_customer_registration_gate set enabled=true where singleton is true;
update private.business_customer_opening_gate set enabled=true where singleton is true;
update private.business_physical_opening_gate set enabled=true where singleton is true;
update private.business_product_stock_count_gate set enabled=true where singleton is true;
update private.business_crate_count_gate set enabled=true where singleton is true;
update private.business_bottle_count_gate set enabled=true where singleton is true;
update private.business_opening_readiness_gate set enabled=true where singleton is true;
update private.business_opening_review_gate set enabled=true where singleton is true;
update private.business_activation_gate set enabled=true where singleton is true;

do $verify$
begin
  if exists (
    select 1 from (values
      ('business_selection_gate'),('business_assortment_setup_gate'),
      ('business_customer_registration_gate'),('business_customer_opening_gate'),
      ('business_physical_opening_gate'),('business_product_stock_count_gate'),
      ('business_crate_count_gate'),('business_bottle_count_gate'),
      ('business_opening_readiness_gate'),('business_opening_review_gate'),
      ('business_activation_gate')
    ) g(name)
    where not case g.name
      when 'business_selection_gate' then (select enabled from private.business_selection_gate where singleton)
      when 'business_assortment_setup_gate' then (select enabled from private.business_assortment_setup_gate where singleton)
      when 'business_customer_registration_gate' then (select enabled from private.business_customer_registration_gate where singleton)
      when 'business_customer_opening_gate' then (select enabled from private.business_customer_opening_gate where singleton)
      when 'business_physical_opening_gate' then (select enabled from private.business_physical_opening_gate where singleton)
      when 'business_product_stock_count_gate' then (select enabled from private.business_product_stock_count_gate where singleton)
      when 'business_crate_count_gate' then (select enabled from private.business_crate_count_gate where singleton)
      when 'business_bottle_count_gate' then (select enabled from private.business_bottle_count_gate where singleton)
      when 'business_opening_readiness_gate' then (select enabled from private.business_opening_readiness_gate where singleton)
      when 'business_opening_review_gate' then (select enabled from private.business_opening_review_gate where singleton)
      when 'business_activation_gate' then (select enabled from private.business_activation_gate where singleton)
    end
  ) then raise exception 'A required Walnik onboarding gate did not open'; end if;

  if (select enabled from private.business_auth_signup_gate where singleton)
     or (select enabled from private.business_registration_gate where singleton)
     or (select enabled from private.business_sales_gate where singleton)
     or (select enabled from private.business_customer_payment_gate where singleton)
     or (select enabled from private.business_receiving_gate where singleton)
     or (select enabled from private.business_cost_history_gate where singleton) then
    raise exception 'A non-onboarding release gate opened unexpectedly';
  end if;
end;
$verify$;
commit;
