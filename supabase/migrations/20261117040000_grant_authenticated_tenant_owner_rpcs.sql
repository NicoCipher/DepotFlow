-- Restore authenticated execution for tenant owner workflows.
-- These SECURITY DEFINER RPCs independently validate auth.uid(), active
-- owner membership, non-legacy tenant scope and their corresponding default-OFF
-- feature gates. Execute grants do not enable any workflow by themselves.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function public.can_record_business_customer_payment(p_business_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path=''
as $can_payment$
declare
  v_actor uuid:=auth.uid();
begin
  if v_actor is null or p_business_id is null then return false; end if;
  perform 1 from private.business_memberships m
    join private.businesses b on b.id=m.business_id
    where m.business_id=p_business_id and m.user_id=v_actor
      and m.member_kind='owner' and m.status='active'
      and b.legacy_singleton is null and b.status='active'
    for share of m,b;
  if not found then return false; end if;
  return exists(select 1 from private.legacy_write_scope_gate where enabled is true)
    and exists(select 1 from private.business_customer_payment_gate where enabled is true);
end;
$can_payment$;
revoke all on function public.can_record_business_customer_payment(uuid) from public,anon;
grant execute on function public.can_record_business_customer_payment(uuid) to authenticated;

revoke all on function public.confirm_business_opening_review(uuid,uuid,text,text,boolean,boolean,boolean,boolean,boolean) from public,anon;
grant execute on function public.confirm_business_opening_review(uuid,uuid,text,text,boolean,boolean,boolean,boolean,boolean) to authenticated;

revoke all on function public.count_business_empty_bottles(uuid,uuid,text,integer,integer,date) from public,anon;
grant execute on function public.count_business_empty_bottles(uuid,uuid,text,integer,integer,date) to authenticated;

revoke all on function public.count_business_empty_crates(uuid,uuid,uuid,integer,integer,date) from public,anon;
grant execute on function public.count_business_empty_crates(uuid,uuid,uuid,integer,integer,date) to authenticated;

revoke all on function public.count_business_product_stock(uuid,uuid,uuid,numeric,numeric,integer,integer,date) from public,anon;
grant execute on function public.count_business_product_stock(uuid,uuid,uuid,numeric,numeric,integer,integer,date) to authenticated;

revoke all on function public.prepare_business_opening_review(uuid) from public,anon;
grant execute on function public.prepare_business_opening_review(uuid) to authenticated;

revoke all on function public.preview_business_opening_count_progress(uuid) from public,anon;
grant execute on function public.preview_business_opening_count_progress(uuid) to authenticated;

revoke all on function public.preview_business_opening_readiness(uuid) from public,anon;
grant execute on function public.preview_business_opening_readiness(uuid) to authenticated;

revoke all on function public.receive_business_stock(uuid,uuid,uuid,numeric,integer,integer,integer,uuid,date) from public,anon;
grant execute on function public.receive_business_stock(uuid,uuid,uuid,numeric,integer,integer,integer,uuid,date) to authenticated;

revoke all on function public.record_business_customer_opening(uuid,uuid,uuid,integer,integer,date,text,jsonb,jsonb) from public,anon;
grant execute on function public.record_business_customer_opening(uuid,uuid,uuid,integer,integer,date,text,jsonb,jsonb) to authenticated;

revoke all on function public.record_business_physical_opening(uuid,uuid,text,text,integer,integer,integer,date) from public,anon;
grant execute on function public.record_business_physical_opening(uuid,uuid,text,text,integer,integer,integer,date) to authenticated;

revoke all on function public.register_business_customer(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.register_business_customer(uuid,uuid,text,text,text,text) to authenticated;

commit;
