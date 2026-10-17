-- M2 physical-empty stock write readiness: deliberately demonstrates the
-- current NO-GO schema on disposable Postgres only. Rolls back everything.
--
-- Do not change this test to pass by sharing physical empties across shops.
-- When a tenant-aware stock migration lands, replace the expected rejection
-- with assertions that both businesses can count the same bottle type
-- independently and that every operational RPC uses a tenant key.
begin;

insert into private.businesses(id,status) values
 ('89900000-0000-4000-9000-000000000001','setup'),
 ('89900000-0000-4000-9000-000000000002','setup');

-- Two depots must be able to count the SAME branded empty bottle type.
-- Today's global PK(bottle_type) forbids the second independent balance.
insert into public.empty_bottle_stock(bottle_type,quantity,business_id)
values ('Goldberg bottle',4,'89900000-0000-4000-9000-000000000001');

do $physical_empty_collision$
declare
  v_rejected boolean := false;
  v_key text;
begin
  select pg_catalog.pg_get_constraintdef(c.oid) into v_key
  from pg_catalog.pg_constraint c
  where c.conrelid='public.empty_bottle_stock'::regclass
    and c.contype='p';
  if v_key <> 'PRIMARY KEY (bottle_type)' then
    raise exception 'Physical-empty key changed: update this NO-GO test and prove independent stock RPC writes (found %)',v_key;
  end if;

  begin
    insert into public.empty_bottle_stock(bottle_type,quantity,business_id)
    values ('Goldberg bottle',9,'89900000-0000-4000-9000-000000000002');
  exception when unique_violation then
    v_rejected := true;
  end;

  if not v_rejected then
    raise exception 'Expected the current global bottle key to reject duplicate branded stock; revisit release gate';
  end if;
  if (select count(*) from public.empty_bottle_stock
      where bottle_type='Goldberg bottle') <> 1
     or (select quantity from public.empty_bottle_stock
      where bottle_type='Goldberg bottle') <> 4 then
    raise exception 'Duplicate-bottle collision changed the first shop balance';
  end if;

  raise notice 'EXPECTED NO-GO: two businesses cannot hold independent Goldberg bottle stock with the current global primary key';
end;
$physical_empty_collision$;

rollback;
