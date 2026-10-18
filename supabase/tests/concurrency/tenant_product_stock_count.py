"""Disposable PostgreSQL 16: first-stock insert races and original-ID retries.

This test uses only nonproduction fixture owners and products. It disables the
staged stock-count gate and revokes its temporary RPC grant during cleanup.
"""
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor

BASE = ["psql", "-h", "/tmp", "-p", "55439", "-d", "postgres",
        "-X", "-At", "-v", "ON_ERROR_STOP=1"]

ids = {key: str(uuid.uuid4()) for key in (
    "legacy", "actor", "business", "crate", "product",
    "first_a", "first_b", "retry", "foreign"
)}

def sql(query: str) -> subprocess.CompletedProcess:
    return subprocess.run(BASE, input=query, text=True, capture_output=True)

def checked(query: str) -> str:
    result = sql(query)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()

def count(request: str, crates: int, loose: int, expected: int, product: str = ""):
    product = product or ids["product"]
    return sql(f"""begin;
      set local role authenticated;
      select set_config('request.jwt.claim.sub','{ids["actor"]}',true);
      select public.count_business_product_stock(
       '{ids["business"]}','{request}','{product}',
       {crates},{loose},{expected},12,'2026-10-18');
      commit;""")

assert checked("select count(*) from private.shop_owner") == "0", "Use an empty disposable DB"

try:
    checked(f"""
      insert into auth.users(id) values
       ('{ids["legacy"]}'),('{ids["actor"]}');
      insert into private.shop_owner(user_id) values('{ids["legacy"]}');
      select private.link_legacy_shop_business();
      select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
      do $x$
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
        if n<>31 then raise exception 'Missing tenant FK count: %',n;end if;
      end;$x$;
      select private.enable_legacy_write_scope(private.legacy_scope_snapshot());
      insert into private.businesses(id,status)
        values('{ids["business"]}','active');
      insert into private.business_memberships(
        business_id,user_id,status,member_kind)
        values('{ids["business"]}','{ids["actor"]}','active','owner');
      alter table public.crate_types disable trigger legacy_scope_business_write;
      alter table public.products disable trigger legacy_scope_business_write;
      insert into public.crate_types(
        id,name,empty_family,pocket_count,business_id)
        values('{ids["crate"]}','Scoped concurrent crate','NB',12,
               '{ids["business"]}');
      insert into public.products(
        id,name,bottles_per_crate,full_crate_price,
        bottles_returnable,crate_type_id,business_id)
        values('{ids["product"]}','Scoped concurrent stock',12,12000,false,
               '{ids["crate"]}','{ids["business"]}');
      alter table public.crate_types enable trigger legacy_scope_business_write;
      alter table public.products enable trigger legacy_scope_business_write;
      grant execute on function public.count_business_product_stock(
        uuid,uuid,uuid,numeric,numeric,integer,integer,date) to authenticated;
      update private.business_product_stock_count_gate
         set enabled=true where singleton;
    """)

    # Both operators saw no stock row; only one different request may
    # create the first balance, never a silent last-write-wins.
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(
            lambda x: count(*x),
            [(ids["first_a"], 2, 1, 0), (ids["first_b"], 3, 1, 0)]
        ))
    assert sum(r.returncode == 0 for r in results) == 1, [
        r.stderr for r in results
    ]
    winner = (ids["first_a"], 2, 1, 25) if results[0].returncode == 0 \
        else (ids["first_b"], 3, 1, 37)
    stock = checked(f"select total_bottles from public.stock where product_id='{ids['product']}'")
    assert stock == str(winner[3]), stock
    assert checked(f"""select count(*) from private.business_product_stock_counts
      where business_id='{ids["business"]}'""") == "1"

    # Exact same request can be checked concurrently without repeating writes.
    with ThreadPoolExecutor(max_workers=2) as pool:
        retries = list(pool.map(
            lambda _: count(winner[0], winner[1], winner[2], 0),
            range(2)
        ))
    assert all(r.returncode == 0 for r in retries), [r.stderr for r in retries]
    assert checked(f"""select count(*) from private.business_product_stock_counts
      where business_id='{ids["business"]}'""") == "1"

    # Two concurrent submissions of the SAME new request ID must both return
    # the same stored count, not insert two audit events.
    with ThreadPoolExecutor(max_workers=2) as pool:
        same = list(pool.map(
            lambda _: count(ids["retry"], 1, 0, winner[3]),
            range(2)
        ))
    assert all(r.returncode == 0 for r in same), [r.stderr for r in same]
    assert checked(f"select total_bottles from public.stock where product_id='{ids['product']}'") == "12"
    assert checked(f"""select count(*) from private.business_product_stock_counts
      where business_id='{ids["business"]}'""") == "2"

    # A stale request with a NEW id must fail; an original replay must still
    # return its original result rather than the latest total.
    stale = count(ids["foreign"], 9, 0, winner[3])
    assert stale.returncode != 0, "Stale count unexpectedly replaced new stock"
    again = count(winner[0], winner[1], winner[2], 0)
    assert again.returncode == 0, again.stderr
    assert f'"total": {winner[3]}' in again.stdout, again.stdout
    assert checked(f"select total_bottles from public.stock where product_id='{ids['product']}'") == "12"
    print("Business product stock count concurrency passed")
finally:
    # Cleanup is administrative and intentionally bypasses owner-only
    # operational triggers; none of these fixtures reaches production.
    checked(f"""begin;
      set local session_replication_role=replica;
      -- Clear all business-tagged operational fixtures, including prices
      -- captured automatically by product catalogue triggers. FK enforcement
      -- is disabled ONLY for this disposable administrative teardown.
      do $delete_business_rows$
      declare r record;
      begin
        for r in select * from private.legacy_scope_tables() loop
          execute format('delete from %I.%I where business_id=$1',
            r.schema_name,r.table_name) using '{ids["business"]}'::uuid;
        end loop;
      end;
      $delete_business_rows$;
      delete from private.business_product_stock_counts
        where business_id='{ids["business"]}';
      delete from public.stock where product_id='{ids["product"]}';
      delete from public.products where id='{ids["product"]}';
      delete from public.crate_types where id='{ids["crate"]}';
      delete from private.business_memberships
        where business_id='{ids["business"]}'
          or business_id in (select id from private.businesses
                            where legacy_singleton is true);
      delete from private.legacy_write_scope_gate
        where business_id in(select id from private.businesses where legacy_singleton is true);
      delete from private.shop_owner where user_id='{ids["legacy"]}';
      delete from private.businesses where id='{ids["business"]}'
        or legacy_singleton is true;
      delete from auth.users where id in ('{ids["legacy"]}','{ids["actor"]}');
      update private.business_product_stock_count_gate
        set enabled=false where singleton;
      revoke execute on function public.count_business_product_stock(
        uuid,uuid,uuid,numeric,numeric,integer,integer,date) from authenticated;
      commit;""")
