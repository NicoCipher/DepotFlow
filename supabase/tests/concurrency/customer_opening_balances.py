"""Disposable PostgreSQL only: same and different opening forms cannot double debt."""
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor
BASE = ["psql", "-h", "/tmp", "-p", "55439", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1"]
owner, customer, request = [str(uuid.uuid4()) for _ in range(3)]
def sql(query):
    return subprocess.run(BASE, input=query, text=True, capture_output=True)
def checked(query):
    result = sql(query)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()
def save(request_id):
    return sql(f"begin;set local role authenticated;select set_config('request.jwt.claim.sub','{owner}',true);select public.record_opening_balances('{request_id}','{customer}',5000,'2026-09-28','','[]','[]');commit;")
assert checked("select count(*) from private.shop_owner") == "0", "Use an empty disposable database"
try:
    checked(f"insert into auth.users(id) values ('{owner}');insert into private.shop_owner(user_id) values ('{owner}');insert into public.customers(id,name,phone) values ('{customer}','Opening test','08000000000');")
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, [request, request]))
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert checked(f"select amount from public.money_owed where customer_id='{customer}'") == "5000"
    checked(f"delete from public.customer_opening_balances where customer_id='{customer}';delete from public.money_owed where customer_id='{customer}';")
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, [str(uuid.uuid4()), str(uuid.uuid4())]))
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    assert checked(f"select amount from public.money_owed where customer_id='{customer}'") == "5000"
    assert checked(f"select count(*) from public.customer_opening_balances where customer_id='{customer}'") == "1"
    print("Opening balance concurrency checks passed")
finally:
    checked(f"delete from public.customer_opening_balances where customer_id='{customer}';delete from public.money_owed where customer_id='{customer}';delete from public.customers where id='{customer}';delete from private.shop_owner where user_id='{owner}';do $$ begin if to_regclass('public.product_selling_price_history') is not null then execute 'delete from public.product_selling_price_history where owner_user_id=' || quote_literal('{owner}'); end if; end $$; delete from auth.users where id='{owner}' ;")
