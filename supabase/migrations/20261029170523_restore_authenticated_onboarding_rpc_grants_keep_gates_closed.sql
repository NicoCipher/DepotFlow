-- Restore the intended authenticated entry-point grants for staged onboarding.
-- This migration deliberately does NOT enable any rollout gate or open public signup.
-- Hosted Auth hook configuration and tenant-isolation release checks remain separate gates.
begin;

revoke all on function public.can_register_business() from public, anon;
revoke all on function public.list_my_businesses_for_setup() from public, anon;
revoke all on function public.register_my_business(uuid,text,text,text) from public, anon;
revoke all on function public.preview_business_assortment_setup(uuid) from public, anon;

grant execute on function public.can_register_business() to authenticated;
grant execute on function public.list_my_businesses_for_setup() to authenticated;
grant execute on function public.register_my_business(uuid,text,text,text) to authenticated;
grant execute on function public.preview_business_assortment_setup(uuid) to authenticated;

commit;
