begin;

-- The current app submits the method-aware payment and exact-empties sale
-- signatures. Older public overloads were temporarily retained for forms
-- opened during rollout; they are no longer part of the supported API.
drop function public.record_payment(uuid,uuid,numeric,date);
drop function public.save_sale_v2(uuid,uuid,date,numeric,jsonb,jsonb,jsonb);
drop function public.save_sale(uuid,uuid,date,numeric,jsonb);

-- No supported function calls the original sale implementation now.
drop function private.save_sale(uuid,uuid,date,numeric,jsonb);

commit;
