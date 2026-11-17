-- Owner-only read gate for the tenant stock-receiving screen.
-- The write remains in receive_business_stock, which repeats all checks.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function public.can_receive_business_stock(p_business_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path=''
as $can_receive$
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
    and exists(select 1 from private.business_receiving_gate where enabled is true);
end;
$can_receive$;
revoke all on function public.can_receive_business_stock(uuid) from public,anon;
grant execute on function public.can_receive_business_stock(uuid) to authenticated;

commit;
