"""Disposable PostgreSQL: return retries and competing forms cannot duplicate stock."""
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor
BASE = ["psql", "-h", "/tmp", "-p", "55439", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1"]
owner, customer, crate, request = [str(uuid.uuid4()) for _ in range(4)]
def sql(query):
    return subprocess.run(BASE, input=query, text=True, capture_output=True)
def checked(query):
    result = sql(query)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()
def save(request_id):
    return sql(f"""begin;set local role authenticated;
      select set_config('request.jwt.claim.sub','{owner}',true);
      select public.record_customer_empty_return('{request_id}','{customer}',
        '[{{"crateTypeId":"{crate}","quantity":1}}]','[]','{{}}');commit;""")
assert checked("select count(*) from private.shop_owner") == "0", "Use an empty disposable database"
try:
    checked(f"""insert into auth.users(id) values ('{owner}');
      insert into private.shop_owner(user_id) values ('{owner}');
      insert into public.customers(id,name,phone) values ('{customer}','Returns test','08000000000');
      insert into public.crate_types(id,name,empty_family,pocket_count) values ('{crate}','Return test','Other',12);
      insert into public.crate_obligations(customer_id,crate_type_id,crate_type,quantity) values ('{customer}','{crate}','Return test',1);""")
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, [request, request]))
    assert all(r.returncode == 0 for r in results), [r.stderr for r in results]
    assert checked(f"select quantity from public.crate_obligations where customer_id='{customer}' and crate_type_id='{crate}'") == "0"
    assert checked(f"select quantity from public.empty_crate_stock where crate_type_id='{crate}'") == "1"
    checked(f"""delete from private.customer_empty_returns where customer_id='{customer}';
      update public.crate_obligations set quantity=1 where customer_id='{customer}' and crate_type_id='{crate}';
      update public.empty_crate_stock set quantity=0 where crate_type_id='{crate}';""")
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(save, [str(uuid.uuid4()),str(uuid.uuid4())]))
    assert sum(r.returncode == 0 for r in results) == 1, [r.stderr for r in results]
    assert checked(f"select quantity from public.crate_obligations where customer_id='{customer}' and crate_type_id='{crate}'") == "0"
    assert checked(f"select quantity from public.empty_crate_stock where crate_type_id='{crate}'") == "1"
    assert checked(f"select count(*) from private.customer_empty_returns where customer_id='{customer}'") == "1"
    print("Customer empty-return concurrency checks passed")
finally:
    checked(f"""delete from private.customer_empty_returns where customer_id='{customer}';
      delete from public.crate_obligations where customer_id='{customer}';
      delete from public.empty_crate_stock where crate_type_id='{crate}';
      delete from public.crate_types where id='{crate}';
      delete from public.customers where id='{customer}';
      delete from private.shop_owner where user_id='{owner}';
      delete from public.product_selling_price_history where owner_user_id='{owner}';
      delete from auth.users where id='{owner}';""")
