"""Disposable PostgreSQL: competing stock receipts and idempotent retries.

No external Supabase connection. The receiving RPC is temporarily granted
only within this disposable fixture and always revoked on cleanup.
"""
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor

BASE = ["psql","-h","/tmp","-p","55439","-d","postgres",
        "-X","-At","-v","ON_ERROR_STOP=1"]

ids = {key: str(uuid.uuid4()) for key in
       ("legacy","actor","business","crate","product",
        "first_a","first_b","next_a","stale")}

def sql(query: str):
    return subprocess.run(BASE, input=query, text=True, capture_output=True)

def checked(query: str) -> str:
    r = sql(query)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()

def receive(request: str, crates: int, stock: int, empties: int):
    return sql(f"""begin;
     set local role authenticated;
     select set_config('request.jwt.claim.sub','{ids["actor"]}',true);
     select public.receive_business_stock(
       '{ids["business"]}','{request}','{ids["product"]}',
       {crates},{stock},{empties},12,'{ids["crate"]}','2026-10-18');
     commit;""")

assert checked("select count(*) from private.shop_owner") == "0", "Requires disposable empty DB"
try:
    checked(f"""
      insert into auth.users(id) values ('{ids["legacy"]}'),('{ids["actor"]}');
      insert into private.shop_owner(user_id) values('{ids["legacy"]}');
      select private.link_legacy_shop_business();
      select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
      do $validate$
      declare r record;n int:=0;
      begin
        for r in
          select ns.nspname s,c.relname t,k.conname
          from pg_constraint k
          join pg_class c on c.oid=k.conrelid
          join pg_namespace ns on ns.oid=c.relnamespace
          join private.legacy_scope_tables() tab
            on tab.schema_name=ns.nspname and tab.table_name=c.relname
          where k.contype='f' and left(k.conname,7)='tenant_'
        loop
          execute format('alter table %I.%I validate constraint %I',
            r.s,r.t,r.conname);
          n:=n+1;
        end loop;
        if n<>31 then raise exception 'Missing tenant FK: %',n;end if;
      end;$validate$;
      select private.enable_legacy_write_scope(private.legacy_scope_snapshot());
      insert into private.businesses(id,status) values('{ids["business"]}','active');
      insert into private.business_memberships(
        business_id,user_id,status,member_kind)
        values('{ids["business"]}','{ids["actor"]}','active','owner');
      alter table public.crate_types disable trigger legacy_scope_business_write;
      alter table public.products disable trigger legacy_scope_business_write;
      alter table public.stock disable trigger legacy_scope_business_write;
      alter table public.empty_crate_stock disable trigger legacy_scope_business_write;
      insert into public.crate_types(id,name,empty_family,pocket_count,business_id)
       values('{ids["crate"]}','Concurrent receiving crate','NB',12,'{ids["business"]}');
      insert into public.products(
        id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id,business_id)
        values('{ids["product"]}','Concurrent receiving drink',12,12000,false,
          '{ids["crate"]}','{ids["business"]}');
      insert into public.stock(product_id,total_bottles,business_id)
        values('{ids["product"]}',24,'{ids["business"]}');
      insert into public.empty_crate_stock(crate_type_id,crate_type,quantity,business_id)
        values('{ids["crate"]}','Concurrent receiving crate',6,'{ids["business"]}');
      alter table public.empty_crate_stock enable trigger legacy_scope_business_write;
      alter table public.stock enable trigger legacy_scope_business_write;
      alter table public.products enable trigger legacy_scope_business_write;
      alter table public.crate_types enable trigger legacy_scope_business_write;
      grant execute on function public.receive_business_stock(
        uuid,uuid,uuid,numeric,integer,integer,integer,uuid,date) to authenticated;
      update private.business_receiving_gate set enabled=true where singleton;
    """)

    # Two different request IDs both saw 24 bottles and 6 empty crates.
    # Exactly one is permitted to commit against that old stock snapshot.
    with ThreadPoolExecutor(max_workers=2) as pool:
        rivals = list(pool.map(
            lambda r: receive(r,1,24,6),
            [ids["first_a"],ids["first_b"]]
        ))
    assert sum(x.returncode == 0 for x in rivals) == 1, [
        x.stderr for x in rivals
    ]
    winner = ids["first_a"] if rivals[0].returncode == 0 else ids["first_b"]
    def assert_totals(stock: int, empties: int, events: int):
        assert checked(f"select total_bottles from public.stock where product_id='{ids['product']}'") == str(stock)
        assert checked(f"select quantity from public.empty_crate_stock where crate_type_id='{ids['crate']}'") == str(empties)
        assert checked(f"select count(*) from private.stock_receipts where business_id='{ids['business']}'") == str(events)
        assert checked(f"select count(*) from public.stock_movements where business_id='{ids['business']}'") == str(events)
        assert checked(f"select count(*) from private.business_receiving_requests where business_id='{ids['business']}'") == str(events)

    assert_totals(36,5,1)
    with ThreadPoolExecutor(max_workers=2) as pool:
        replay = list(pool.map(lambda _: receive(winner,1,24,6),range(2)))
    assert all(x.returncode == 0 for x in replay), [x.stderr for x in replay]
    assert_totals(36,5,1)

    # Identical concurrent retries of a second request must record only
    # one +24-bottle / -2-empty-crate movement and one immutable receipt.
    with ThreadPoolExecutor(max_workers=2) as pool:
        again = list(pool.map(
            lambda _: receive(ids["next_a"],2,36,5),range(2)
        ))
    assert all(x.returncode == 0 for x in again), [x.stderr for x in again]
    assert_totals(60,3,2)

    stale = receive(ids["stale"],1,36,5)
    assert stale.returncode != 0, "A stale request overwrote the latest physical stock"
    too_many = receive(str(uuid.uuid4()),4,60,3)
    assert too_many.returncode != 0, "Insufficient empty crates did not block receiving"
    original = receive(winner,1,24,6)
    assert original.returncode == 0, original.stderr
    assert '"stock_after": 36' in original.stdout, original.stdout
    assert_totals(60,3,2)
    print("Business receiving concurrency and unchanged-original-replay passed")
finally:
    checked(f"""begin;
      set local session_replication_role=replica;
      delete from private.business_receiving_requests
        where business_id='{ids["business"]}';
      delete from private.stock_receipts where business_id='{ids["business"]}';
      delete from public.stock_movements where business_id='{ids["business"]}';
      delete from public.empty_crate_stock where crate_type_id='{ids["crate"]}';
      delete from public.stock where product_id='{ids["product"]}';
      delete from public.products where id='{ids["product"]}';
      delete from public.crate_types where id='{ids["crate"]}';
      delete from private.business_memberships where business_id='{ids["business"]}';
      delete from private.legacy_write_scope_gate
        where business_id in(select id from private.businesses where legacy_singleton is true);
      delete from private.shop_owner where user_id='{ids["legacy"]}';
      delete from private.businesses where id='{ids["business"]}' or legacy_singleton is true;
      delete from auth.users where id in('{ids["legacy"]}','{ids["actor"]}');
      update private.business_receiving_gate set enabled=false where singleton;
      revoke execute on function public.receive_business_stock(
        uuid,uuid,uuid,numeric,integer,integer,integer,uuid,date) from authenticated;
      commit;""")
