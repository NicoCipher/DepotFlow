begin;

-- Controlled Cash + Transfer checkout activation.
-- The app's NEXT_PUBLIC_SPLIT_TENDER_ENABLED flag remains independent and
-- defaults OFF. This grant is restricted to signed-in users; the saver itself
-- checks private.shop_owner on every call.
do $release_guard$
begin
  if to_regclass('public.sale_tender_legs') is null or
     to_regclass('private.split_sale_request_fences') is null or
     not exists (select 1 from pg_trigger
       where tgname='reject_fenced_sale_request' and tgenabled <> 'D') or
     not exists (select 1 from pg_trigger
       where tgname='sale_tender_complete_on_mixed_sale' and tgenabled <> 'D') or
     not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='check_split_sale_request'
       and pg_get_functiondef(p.oid) like '%split_sale_request_fences%') or
     not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='verify_receipt'
       and pg_get_functiondef(p.oid) like '%sale_tender_legs%') then
    raise exception using errcode='22023',
      message='Split checkout activation blocked: complete ledger, receipts and request fencing first.';
  end if;
end;
$release_guard$;

revoke all on function public.save_sale_split_tender(
 uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb
) from public,anon,authenticated;
grant execute on function public.save_sale_split_tender(
 uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb
) to authenticated;

commit;

-- Emergency database rollback (new migration, not destructive history edit):
-- revoke execute on function public.save_sale_split_tender(
--   uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb
-- ) from authenticated;
-- Disable NEXT_PUBLIC_SPLIT_TENDER_ENABLED on Vercel and REDEPLOY.
-- Keep check_split_sale_request executable for any uncertain existing drafts.
