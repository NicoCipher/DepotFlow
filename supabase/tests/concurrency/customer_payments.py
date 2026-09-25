"""Run only against the disposable local migrated DB on port 55439.
Two real concurrent record_payment calls against the same customer:
one scenario where only one of two equal payments can fit, and one
where both fit. Fixtures use random IDs; cleanup runs even on failure.
"""
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor

BASE = ["psql", "-h", "/tmp", "-p", "55439", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1"]
owner, customer = [str(uuid.uuid4()) for _ in range(2)]

def sql(query):
    return subprocess.run(BASE, input=query, text=True, capture_output=True)

def checked(query):
    result = sql(query)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()

def as_owner(query):
    return sql(f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{owner}',true); {query}; commit;")

assert checked("select count(*) from private.shop_owner") == "0", "Use an empty disposable database"
try:
    checked(f"""begin;
insert into auth.users(id) values ('{owner}');
insert into private.shop_owner(user_id) values ('{owner}');
insert into public.customers(id,name,phone) values ('{customer}','Concurrency fixture','+2348030000099');
commit;""")

    # 20000 owed, two concurrent 15000 payments: only one can fit.
    checked(f"insert into public.money_owed(customer_id,amount) values ('{customer}',20000)")
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(
            lambda _: as_owner(f"select public.record_payment('{uuid.uuid4()}','{customer}',15000,'2026-02-01')"),
            range(2),
        ))
    assert sum(r.returncode == 0 for r in results) == 1, [(r.returncode, r.stderr) for r in results]
    assert any("exceed" in r.stderr.lower() for r in results), [r.stderr for r in results]
    assert checked(f"select amount from public.money_owed where customer_id='{customer}'") == "5000"
    assert checked(f"select count(*) from public.customer_payments where customer_id='{customer}'") == "1"

    # Reset to 30000 owed, two concurrent 10000 payments: both fit, 10000 left.
    checked(f"""delete from public.customer_payments where customer_id='{customer}';
update public.money_owed set amount=30000 where customer_id='{customer}'""")
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(
            lambda _: as_owner(f"select public.record_payment('{uuid.uuid4()}','{customer}',10000,'2026-02-02')"),
            range(2),
        ))
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert checked(f"select amount from public.money_owed where customer_id='{customer}'") == "10000"
    assert checked(f"select count(*) from public.customer_payments where customer_id='{customer}'") == "2"
    print("Concurrent payment isolation checks passed")
finally:
    checked(f"""delete from public.customer_payments where customer_id='{customer}';
delete from public.money_owed where customer_id='{customer}';
delete from public.customers where id='{customer}';
delete from private.shop_owner where user_id='{owner}';
delete from auth.users where id='{owner}'""")
