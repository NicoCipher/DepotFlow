"""Run only against the disposable local migrated DB on port 55439.
Two real concurrent scenarios between save_sale and archive/restore on the
same customer row, proving the lock ordering (not just the sequential case
already covered in supabase/tests/customer_archiving.sql):
  - the sale's row lock wins the race -> archive blocks, then completes after
  - the archive's row lock wins the race -> the sale blocks, then sees the
    committed archive and is rejected
Fixtures use random IDs; cleanup runs even on failure.
"""
import subprocess
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

BASE = ["psql", "-h", "/tmp", "-p", "55439", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1"]
owner, crate_type, product = [str(uuid.uuid4()) for _ in range(3)]
customer_sale_wins, customer_archive_wins = str(uuid.uuid4()), str(uuid.uuid4())

LINE = (
    '{{"productId":"{product}","quantity":{{"crates":1,"fraction":0,"bottles":0}},'
    '"returnedCrates":0,"returnedBottles":0,'
    '"expected":{{"full":12000,"half":6000,"quarter":3000,"bottle":1000,"size":12,'
    '"crate":"{crate_type}","returnable":false,"bottleType":null,"stock":100}}}}'
).format(product=product, crate_type=crate_type)


def sql(query):
    return subprocess.run(BASE, input=query, text=True, capture_output=True)


def checked(query):
    result = sql(query)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def as_owner(*statements):
    body = "; ".join(statements)
    return sql(
        f"begin; set local role authenticated; "
        f"select set_config('request.jwt.claim.sub','{owner}',true); {body}; commit;"
    )


assert checked("select count(*) from private.shop_owner") == "0", "Use an empty disposable database"
try:
    checked(f"""begin;
insert into auth.users(id) values ('{owner}');
insert into private.shop_owner(user_id) values ('{owner}');
insert into public.customers(id,name,phone) values
  ('{customer_sale_wins}','Sale wins fixture','+2348030000101'),
  ('{customer_archive_wins}','Archive wins fixture','+2348030000102');
insert into public.crate_types(id,name,empty_family,pocket_count) values
  ('{crate_type}','Concurrency test crate','Test',12);
insert into public.products(id,name,bottles_per_crate,full_crate_price,half_crate_price,quarter_crate_price,bottle_price,bottles_returnable,crate_type_id) values
  ('{product}','Concurrency test drink',12,12000,6000,3000,1000,false,'{crate_type}');
insert into public.stock(product_id,total_bottles) values ('{product}',1000);
commit;""")

    # The sale's row lock wins the race: its FOR SHARE is granted first, so
    # the concurrent archive attempt must block until the sale's transaction
    # ends, then proceed.
    with ThreadPoolExecutor(max_workers=2) as pool:
        sale_future = pool.submit(
            as_owner,
            f"select public.save_sale('{uuid.uuid4()}','{customer_sale_wins}','2026-09-27',12000,'[{LINE}]'::jsonb)",
            "select pg_sleep(1)",
        )
        time.sleep(0.3)  # let the sale's SELECT ... FOR SHARE be granted first
        archive_future = pool.submit(
            as_owner,
            f"update public.customers set archived_at=now() where id='{customer_sale_wins}'",
        )
        sale_result, archive_result = sale_future.result(), archive_future.result()
    assert sale_result.returncode == 0, sale_result.stderr
    assert archive_result.returncode == 0, archive_result.stderr
    assert checked(f"select count(*) from public.sales where customer_id='{customer_sale_wins}'") == "1"
    assert checked(f"select archived_at is not null from public.customers where id='{customer_sale_wins}'") == "t"

    # The archive's row lock wins the race: its implicit FOR NO KEY UPDATE is
    # granted first, so the concurrent sale's FOR SHARE must block until the
    # archive commits, then see the archived customer and be rejected.
    with ThreadPoolExecutor(max_workers=2) as pool:
        archive_future = pool.submit(
            as_owner,
            f"update public.customers set archived_at=now() where id='{customer_archive_wins}'",
            "select pg_sleep(1)",
        )
        time.sleep(0.3)  # let the archive's UPDATE lock be granted first
        sale_future = pool.submit(
            as_owner,
            f"select public.save_sale('{uuid.uuid4()}','{customer_archive_wins}','2026-09-27',12000,'[{LINE}]'::jsonb)",
        )
        archive_result, sale_result = archive_future.result(), sale_future.result()
    assert archive_result.returncode == 0, archive_result.stderr
    assert sale_result.returncode != 0, "Sale against an archived customer was not rejected"
    assert "archived" in sale_result.stderr.lower(), sale_result.stderr
    assert checked(f"select count(*) from public.sales where customer_id='{customer_archive_wins}'") == "0"
    print("Concurrent archive/save_sale lock-ordering checks passed")
finally:
    checked(f"""
delete from public.stock_movements where sale_id in (select id from public.sales where customer_id in ('{customer_sale_wins}','{customer_archive_wins}'));
delete from public.sale_items where sale_id in (select id from public.sales where customer_id in ('{customer_sale_wins}','{customer_archive_wins}'));
delete from public.sales where customer_id in ('{customer_sale_wins}','{customer_archive_wins}');
delete from public.crate_obligations where customer_id in ('{customer_sale_wins}','{customer_archive_wins}');
delete from public.bottle_obligations where customer_id in ('{customer_sale_wins}','{customer_archive_wins}');
delete from public.money_owed where customer_id in ('{customer_sale_wins}','{customer_archive_wins}');
delete from public.stock where product_id='{product}';
delete from public.products where id='{product}';
delete from public.crate_types where id='{crate_type}';
delete from public.customers where id in ('{customer_sale_wins}','{customer_archive_wins}');
delete from private.shop_owner where user_id='{owner}';
delete from auth.users where id='{owner}'""")
