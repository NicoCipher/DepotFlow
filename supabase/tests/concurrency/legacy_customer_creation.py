"""Real concurrent original-shop customer creation (disposable PG16 only).

Eight simultaneous retries of one request must produce one server-issued
customer ID and one immutable audit row. Uses actual authenticated role and
never supplies a chosen customer primary key.
"""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import json
import subprocess
import uuid

DB = ["psql", "-h", "/tmp", "-p", "55439", "-d", "postgres",
      "-X", "-At", "-v", "ON_ERROR_STOP=1"]
owner = str(uuid.uuid4())
request_id = str(uuid.uuid4())
phone = "08012349991"


def run(sql):
    return subprocess.run(DB, input=sql, text=True, capture_output=True)


def checked(sql):
    result = run(sql)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def create(req, name="Concurrent legacy customer"):
    return run(f"""begin;
    set local role authenticated;
    select set_config('request.jwt.claim.sub','{owner}',true);
    select public.create_legacy_customer(
      '{req}','{name}','{phone}',null,null);
    commit;""")


def response(result):
    assert result.returncode == 0, result.stderr
    rows = [line for line in result.stdout.splitlines()
            if line.strip().startswith("{")]
    assert len(rows) == 1, result.stdout
    return json.loads(rows[0])


assert checked("select count(*) from private.shop_owner") == "0", (
    "Disposable isolated database required")
try:
    checked(f"""insert into auth.users(id) values ('{owner}');
    insert into private.shop_owner(user_id) values ('{owner}');""")

    n = 8
    barrier = Barrier(n)

    def retry(_):
        barrier.wait()
        return create(request_id)

    with ThreadPoolExecutor(max_workers=n) as executor:
        answers = [response(result) for result in executor.map(retry, range(n))]

    customer_ids = {answer["customerId"] for answer in answers}
    assert len(customer_ids) == 1, answers
    assert request_id not in customer_ids, "Request token used as global PK"
    assert sum(answer["savedReplay"] is False for answer in answers) == 1
    assert sum(answer["savedReplay"] is True for answer in answers) == n-1
    assert checked(f"""select count(*) from public.customers
      where phone='{phone}'""") == "1"
    assert checked(f"""select count(*) from private.legacy_customer_creation_requests
      where owner_id='{owner}' and request_id='{request_id}'""") == "1"

    changed = create(request_id, "Conflicting replay customer")
    assert changed.returncode != 0, "Modified retry was accepted"
    assert "different details" in changed.stderr, changed.stderr

    checked(f"delete from private.shop_owner where user_id='{owner}';")
    revoked = create(request_id)
    assert revoked.returncode != 0, "Revoked owner replayed identity"
    assert checked(f"""select count(*) from public.customers
      where phone='{phone}'""") == "1"
    print("Legacy customer concurrent idempotency and revocation PASSED")
finally:
    checked(f"""begin;
      delete from private.legacy_customer_creation_requests
       where owner_id='{owner}';
      delete from public.customers where phone='{phone}';
      -- User-scoped catalogue/price history is seeded by database triggers.
      -- Tear it down before deleting the referenced Auth user.
      delete from public.product_selling_price_history
       where owner_user_id='{owner}';
      delete from public.product_cost_history
       where owner_user_id='{owner}';
      delete from private.shop_owner where user_id='{owner}';
      delete from auth.users where id='{owner}';
      commit;""")
