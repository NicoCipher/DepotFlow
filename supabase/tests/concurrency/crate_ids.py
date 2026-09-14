"""Run only against the disposable local migrated DB on port 55439.
Real concurrent SQL sessions test first counts, duplicate requests and receiving.
Fixtures have random IDs; cleanup runs even if an assertion fails.
"""
import json
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor

BASE = ["psql", "-h", "/tmp", "-p", "55439", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1"]
owner, crate, product, count_request = [str(uuid.uuid4()) for _ in range(4)]

def sql(query):
    return subprocess.run(BASE, input=query, text=True, capture_output=True)

def checked(query):
    result = sql(query)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()

def as_owner(query):
    return sql(f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{owner}',true); {query}; commit;")

# Do not run this test if the disposable DB contains a configured owner.
assert checked("select count(*) from private.shop_owner") == "0", "Use an empty disposable DB"
try:
    checked(f"""begin;
insert into auth.users(id) values ('{owner}');
insert into private.shop_owner(user_id) values ('{owner}');
insert into public.crate_types(id,name,empty_family,pocket_count) values ('{crate}','Concurrency fixture','Test',12);
insert into public.products(id,name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id)
values ('{product}','Concurrency fixture',12,0,false,'{crate}');
commit;""")
    # Eight simultaneous copies of one first-count submission produce one row.
    query = f"select public.set_empty_crate_count('{count_request}','{crate}',10,'2024-03-01',null)"
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: as_owner(query), range(8)))
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert checked(f"select count(*) from public.empty_crate_movements where crate_type_id='{crate}'") == "1"
    # A receipt and a replacement count race from the SAME review snapshot.
    # Exactly one wins; the other must reject its now-stale snapshot.
    queries = [
        f"select public.receive_stock('{uuid.uuid4()}','{product}',2,0,10,12,'{crate}','2024-03-02')",
        f"select public.set_empty_crate_count('{uuid.uuid4()}','{crate}',20,'2024-03-02',10)",
    ]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(as_owner, queries))
    assert sum(r.returncode == 0 for r in results) == 1, [(r.returncode,r.stderr) for r in results]
    assert any("changed" in r.stderr for r in results), [r.stderr for r in results]
    state = json.loads(checked(f"select json_build_object('empties',quantity,'bottles',coalesce((select total_bottles from public.stock where product_id='{product}'),0)) from public.empty_crate_stock where crate_type_id='{crate}'"))
    assert state in [{"empties":8,"bottles":24},{"empties":20,"bottles":0}], state
    print("Concurrent duplicate-count and receiving/count isolation checks passed")
finally:
    checked(f"""begin;
delete from private.stock_receipts where product_id='{product}';
delete from public.stock_movements where product_id='{product}';
delete from public.empty_crate_movements where crate_type_id='{crate}';
delete from public.stock where product_id='{product}';
delete from public.products where id='{product}';
delete from public.empty_crate_stock where crate_type_id='{crate}';
delete from public.crate_types where id='{crate}';
delete from private.shop_owner where user_id='{owner}';
delete from auth.users where id='{owner}';
commit;""")
