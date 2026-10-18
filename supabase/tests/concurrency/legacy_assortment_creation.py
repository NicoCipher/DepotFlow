"""Concurrent legacy crate + drink retries against disposable Postgres 16 only.

Each request token must produce exactly one DB-generated global PK. No browser
or other tenant can choose that PK, replay with changed fields or bypass owner
revocation. This uses separate authenticated SQL connections, not mocks.
"""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import subprocess
import uuid

DB = ["psql", "-h", "/tmp", "-p", "55439", "-d", "postgres",
      "-X", "-At", "-v", "ON_ERROR_STOP=1"]
OWNER, CRATE_REQUEST, DRINK_REQUEST = (str(uuid.uuid4()) for _ in range(3))


def run(sql: str):
    return subprocess.run(DB, input=sql, text=True, capture_output=True)


def checked(sql: str) -> str:
    result = run(sql)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def create_crate(token: str, name: str = "Concurrent test crate"):
    return run(f"""begin;
      set local role authenticated;
      select set_config('request.jwt.claim.sub','{OWNER}',true);
      select public.create_legacy_crate_type(
       '{token}','{name}','NB',20,null);
      commit;""")


def create_drink(token: str, crate: str, name: str = "Concurrent test drink"):
    return run(f"""begin;
      set local role authenticated;
      select set_config('request.jwt.claim.sub','{OWNER}',true);
      select public.create_legacy_product(
       '{token}','{name}',null,null,'{crate}',20,10000,
       null,null,500,true,'Test bottle',null);
      commit;""")


def pk(result) -> str:
    assert result.returncode == 0, result.stderr
    uuid_lines = []
    for line in result.stdout.splitlines():
        try:
            uuid_lines.append(str(uuid.UUID(line.strip())))
        except (ValueError, AttributeError):
            continue
    assert len(uuid_lines) == 1, result.stdout
    return uuid_lines[0]


def eight(fn):
    barrier = Barrier(8)

    def race(_):
        barrier.wait()
        return pk(fn())

    with ThreadPoolExecutor(max_workers=8) as executor:
        return list(executor.map(race, range(8)))


assert checked("select count(*) from private.shop_owner") == "0", (
    "Separate disposable PG16 fixture required")
try:
    checked(f"""insert into auth.users(id) values ('{OWNER}');
      insert into private.shop_owner(user_id) values ('{OWNER}');""")
    crate_ids = eight(lambda: create_crate(CRATE_REQUEST))
    assert len(set(crate_ids)) == 1, crate_ids
    crate = crate_ids[0]
    assert crate != CRATE_REQUEST
    assert checked(f"""select count(*) from private.legacy_assortment_creation_requests
       where owner_id='{OWNER}' and resource_kind='crate'
         and request_id='{CRATE_REQUEST}'""") == "1"
    assert checked("""select count(*) from public.crate_types
       where name='Concurrent test crate'""") == "1"
    bad = create_crate(CRATE_REQUEST, "Altered request")
    assert bad.returncode != 0 and "different details" in bad.stderr, bad.stderr

    product_ids = eight(lambda: create_drink(DRINK_REQUEST, crate))
    assert len(set(product_ids)) == 1, product_ids
    product = product_ids[0]
    assert product != DRINK_REQUEST
    assert checked(f"""select count(*) from private.legacy_assortment_creation_requests
       where owner_id='{OWNER}' and resource_kind='product'
         and request_id='{DRINK_REQUEST}'""") == "1"
    assert checked("""select count(*) from public.products
       where name='Concurrent test drink'""") == "1"
    bad = create_drink(DRINK_REQUEST, crate, "Altered drink")
    assert bad.returncode != 0 and "different details" in bad.stderr, bad.stderr

    checked(f"delete from private.shop_owner where user_id='{OWNER}';")
    assert create_crate(CRATE_REQUEST).returncode != 0, "Revoked owner crate replayed"
    assert create_drink(DRINK_REQUEST, crate).returncode != 0, (
        "Revoked owner drink replayed")
    print("Legacy generated-ID crate/product concurrency and revocation PASSED")
finally:
    checked(f"""begin;
      delete from private.legacy_assortment_creation_requests where owner_id='{OWNER}';
      delete from public.products where name='Concurrent test drink';
      delete from public.crate_types where name='Concurrent test crate';
      delete from public.product_selling_price_history where owner_user_id='{OWNER}';
      delete from public.product_cost_history where owner_user_id='{OWNER}';
      delete from private.shop_owner where user_id='{OWNER}';
      delete from auth.users where id='{OWNER}';
      commit;""")
