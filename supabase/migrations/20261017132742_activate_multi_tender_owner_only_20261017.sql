begin;

-- Activation is separate from schema installation and Vercel feature flag.
-- Keep existing Cash + Transfer RPC fully operational during this release.
do $$
begin
  if to_regclass('public.sale_tender_legs') is null
    or to_regclass('private.split_sale_request_fences') is null
    or to_regprocedure('public.save_sale_multi_tender(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb)') is null
    or to_regprocedure('public.save_sale_split_tender(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb)') is null then
    raise exception using errcode='55000',
      message='Multi-payment release prerequisites are missing.';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.sale_tender_legs'::regclass
      and conname='sale_tender_legs_method_check'
      and pg_get_constraintdef(oid) like '%pos%'
  ) then
    raise exception using errcode='55000',
      message='POS tender ledger constraint is not installed.';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname='sale_tender_complete_on_mixed_sale'
      and tgenabled <> 'D'
  ) or not exists (
    select 1 from pg_trigger
    where tgname='reject_fenced_sale_request'
      and tgenabled <> 'D'
  ) then
    raise exception using errcode='55000',
      message='Multi-payment ledger or uncertain-save fence is disabled.';
  end if;
  if not has_function_privilege(
    'authenticated',
    'public.save_sale_split_tender(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb)',
    'EXECUTE'
  ) then
    raise exception using errcode='55000',
      message='Existing Cash + Transfer saver must remain active.';
  end if;
end;
$$;

-- No PUBLIC/anon access. The SECURITY DEFINER implementation independently
-- checks auth.uid against private.shop_owner on every invocation.
revoke all on function public.save_sale_multi_tender(
 uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb
) from public,anon,authenticated;
grant execute on function public.save_sale_multi_tender(
 uuid,uuid,date,numeric,jsonb,jsonb,jsonb,numeric,jsonb
) to authenticated;

commit;

-- Emergency rollback: in a NEW tracked migration, revoke EXECUTE from
-- authenticated, keep old Cash + Transfer RPC, immutable tender ledger,
-- Check Sale fencing, existing receipts, and stored sales untouched.
