"""Real PostgreSQL concurrency for verified, owner-scoped business registration.

Same request ID from simultaneous HTTP retries must create ONE depot.
Different request IDs for the same exact location must not create copies.
Uses only disposable CI postgres; cleanup restores gates and grants.
"""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import subprocess
import uuid

DB = ["psql", "-h", "/tmp", "-p", "55439", "-d", "postgres",
      "-X", "-At", "-v", "ON_ERROR_STOP=1"]
actor = str(uuid.uuid4())
request = str(uuid.uuid4())
request_other = [str(uuid.uuid4()), str(uuid.uuid4())]


def run(sql):
    return subprocess.run(DB, input=sql, text=True, capture_output=True)


def checked(sql):
    p = run(sql)
    assert p.returncode == 0, p.stderr
    return p.stdout.strip()


def owner_call(request_id, name, address):
    return run(f"""begin;
    set local role authenticated;
    select set_config('request.jwt.claim.sub','{actor}',true);
    select public.register_my_business(
      '{request_id}','{name}','{address}','08004448888');
    commit;""")


assert checked("select count(*) from private.shop_owner") == "0", "Must use disposable DB"
try:
    checked(f"""insert into auth.users(id,email_confirmed_at)
                  values ('{actor}',now());
                update private.business_selection_gate set enabled=true;
                update private.business_registration_gate set enabled=true;
                grant execute on function public.register_my_business(uuid,text,text,text)
                  to authenticated;""")

    n = 8
    barrier = Barrier(n)
    def same_request(_):
        barrier.wait()
        return owner_call(request, "Race Owner Shop", "Ikeja")
    with ThreadPoolExecutor(max_workers=n) as executor:
        outcomes = list(executor.map(same_request, range(n)))
    assert all(p.returncode == 0 for p in outcomes), [p.stderr for p in outcomes]
    assert checked(f"""select count(*) from private.business_registration_requests
                     where owner_id='{actor}'""") == "1"
    assert checked(f"""select count(*) from private.business_memberships
                     where user_id='{actor}'""") == "1"

    # Same shop accidentally submitted with DIFFERENT request IDs must have
    # one winner, not two depot identities or partial memberships.
    barrier2 = Barrier(2)
    def different_request(request_id):
        barrier2.wait()
        return owner_call(request_id, "Race Second Branch", "Yaba")
    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(different_request, request_other))
    assert sum(p.returncode == 0 for p in outcomes) == 1, [
        p.stderr for p in outcomes
    ]
    assert checked(f"""select count(*) from private.business_registration_requests
                     where owner_id='{actor}'""") == "2"
    assert checked(f"""select count(*) from private.business_memberships
                     where user_id='{actor}'""") == "2"
    assert checked(f"""select count(*) from public.business_profiles
                     where name='Race Second Branch' and address='Yaba'""") == "1"

    # Third branch is allowed, fourth is not. Save a third request, then
    # retry it after reaching the cap: the immutable request still resolves.
    third = str(uuid.uuid4())
    fourth = str(uuid.uuid4())
    assert owner_call(third, "Race Third Branch", "Ojota").returncode == 0
    assert owner_call(fourth, "Race Fourth Branch", "Surulere").returncode != 0
    assert owner_call(third, "Race Third Branch", "Ojota").returncode == 0
    assert checked(f"""select count(*) from private.business_memberships
                     where user_id='{actor}'""") == "3"
    print("Registration concurrency, duplicate suppression and capped replay PASSED")
finally:
    checked(f"""begin;
    set local session_replication_role=replica;
    create temporary table race_businesses as
      select business_id from private.business_memberships
      where user_id='{actor}';
    delete from private.business_registration_requests where owner_id='{actor}';
    delete from public.business_profiles where business_id in (
      select business_id from race_businesses);
    delete from private.business_memberships where user_id='{actor}';
    delete from private.businesses where id in (
      select business_id from race_businesses);
    delete from auth.users where id='{actor}';
    update private.business_registration_gate set enabled=false;
    update private.business_selection_gate set enabled=false;
    revoke execute on function public.register_my_business(uuid,text,text,text)
      from authenticated;
    commit;""")
