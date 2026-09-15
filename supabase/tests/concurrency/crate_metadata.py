"""Disposable local DB on port 55439 only. Exercise both lock acquisition orders."""
import os
import subprocess
import time
import uuid

BASE = ["psql", "-h", "/tmp", "-p", "55439", "-d", "postgres", "-X", "-At", "-v", "ON_ERROR_STOP=1"]
owner, crate = [str(uuid.uuid4()) for _ in range(2)]

def sql(query):
    return subprocess.run(BASE, input=query, text=True, capture_output=True)

def checked(query):
    result = sql(query)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()

def owner_query(query):
    return f"begin; set local role authenticated; select set_config('request.jwt.claim.sub','{owner}',true); {query}; commit;"

def race(first, second):
    tag = "crate_metadata_test_" + uuid.uuid4().hex
    process = subprocess.Popen(BASE, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env={**os.environ, "PGAPPNAME": tag})
    process.stdin.write(owner_query(first + "; select pg_sleep(1)"))
    process.stdin.close()
    for _ in range(100):
        if checked(f"select count(*) from pg_stat_activity where application_name='{tag}' and wait_event='PgSleep'") == "1":
            break
        time.sleep(0.02)
    else:
        process.kill()
        raise AssertionError("First session never reached the held-lock state")
    result = sql(owner_query(second))
    process.wait(timeout=5)
    assert process.returncode == 0, process.stderr.read()
    assert result.returncode != 0 and "pocket" in result.stderr.lower(), result.stderr

assert checked("select count(*) from private.shop_owner") == "0", "Use an empty disposable database"
try:
    checked(f"insert into auth.users(id) values('{owner}'); insert into private.shop_owner(user_id) values('{owner}'); insert into public.crate_types(id,name,empty_family,pocket_count) values('{crate}','Test crate','Test',12)")
    insert = f"insert into public.products(name,bottles_per_crate,full_crate_price,bottles_returnable,crate_type_id) values('Test drink',12,0,false,'{crate}')"
    edit = f"select public.edit_crate_type('{crate}','Changed crate','Test',20,'Short')"
    race(insert, edit)
    assert checked(f"select pocket_count from public.crate_types where id='{crate}'") == "12"
    checked(f"delete from public.products where crate_type_id='{crate}'")
    race(edit, insert)
    assert checked(f"select count(*) from public.products where crate_type_id='{crate}'") == "0"
    assert checked(f"select pocket_count from public.crate_types where id='{crate}'") == "20"
    print("Concurrent assignment/metadata checks passed in both lock orders")
finally:
    checked(f"delete from public.products where crate_type_id='{crate}'; delete from public.crate_types where id='{crate}'; delete from private.shop_owner where user_id='{owner}'; delete from auth.users where id='{owner}'")
