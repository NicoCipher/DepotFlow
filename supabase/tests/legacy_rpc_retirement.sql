begin;
do $$ begin
  if to_regprocedure('public.record_payment(uuid,uuid,numeric,date)') is not null
    or to_regprocedure('public.save_sale_v2(uuid,uuid,date,numeric,jsonb,jsonb,jsonb)') is not null
    or to_regprocedure('public.save_sale(uuid,uuid,date,numeric,jsonb)') is not null
    or to_regprocedure('private.save_sale(uuid,uuid,date,numeric,jsonb)') is not null then
    raise exception 'An obsolete sale or payment RPC is still installed';
  end if;
  if to_regprocedure('public.record_payment(uuid,uuid,numeric,date,text)') is null
    or to_regprocedure('public.save_sale_v2(uuid,uuid,date,numeric,jsonb,jsonb,jsonb,text)') is null then
    raise exception 'A supported sale or payment RPC was removed';
  end if;
end $$;
rollback;
