"""Real PostgreSQL 16 race: a direct ZERO count versus first-only opening.

Every type of physical item (drink, crate, bottle) must serialize its
'never counted' check with ordinary owners who count the same item by a
different request UUID. Uses disposable local Postgres; never production.
"""
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

BASE = ["psql", "-h", "/tmp", "-p", "55439", "-d", "postgres",
        "-X", "-At", "-v", "ON_ERROR_STOP=1"]
ids = {k: str(uuid.uuid4()) for k in (
    "legacy", "actor", "business", "crate", "product",
    "drink_direct", "drink_opening", "crate_direct", "crate_opening",
    "bottle_direct", "bottle_opening"
)}

def sql(query):
    return subprocess.run(BASE, input=query, text=True, capture_output=True)

def checked(query):
    out = sql(query)
    assert out.returncode == 0, out.stderr
    return out.stdout.strip()

def as_owner(statement):
    return sql(f"""begin;
     set local role authenticated;
     select set_config('request.jwt.claim.sub','{ids["actor"]}',true);
     select {statement};
     commit;""")

def competing(label, opening_call, direct_call, stock_query, opening_quantity):
    barrier = Barrier(2)
    def run(statement):
        barrier.wait()
        return as_owner(statement)
    with ThreadPoolExecutor(max_workers=2) as pool:
        handles = [pool.submit(run, direct_call),
                   pool.submit(run, opening_call)]
        results = [f.result() for f in handles]
    assert sum(x.returncode == 0 for x in results) == 1, [
        label, results[0].stderr, results[1].stderr
    ]
    winner = "direct" if results[0].returncode == 0 else "opening"
    expected = "0" if winner == "direct" else str(opening_quantity)
    actual = checked(stock_query)
    assert actual == expected, (label, winner, actual, expected)
    recorded = checked(f"""select count(*) from private.business_physical_opening_lines
     where business_id='{ids["business"]}' and kind='{label}'""")
    assert recorded == ("0" if winner == "direct" else "1"), (label, recorded)
    print(f"{label}: {winner} serialized first; physical={actual}")

assert checked("select count(*) from private.shop_owner") == "0", "Requires disposable DB"
try:
    checked(f"""
      insert into auth.users(id) values('{ids["legacy"]}'),('{ids["actor"]}');
      insert into private.shop_owner(user_id) values('{ids["legacy"]}');
      select private.link_legacy_shop_business();
      select private.backfill_legacy_shop_rows(private.legacy_scope_snapshot());
      do $validate$
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
       if n<>31 then raise exception 'Missing tenant foreign keys: %',n;end if;
      end;$validate$;
      select private.enable_legacy_write_scope(private.legacy_scope_snapshot());
      insert into private.businesses(id,status)
       values('{ids["business"]}','setup');
      insert into private.business_memberships(
       business_id,user_id,status,member_kind)
       values('{ids["business"]}','{ids["actor"]}','active','owner');
      alter table public.crate_types disable trigger legacy_scope_business_write;
      alter table public.products disable trigger legacy_scope_business_write;
      insert into public.crate_types(id,name,empty_family,pocket_count,business_id)
       values('{ids["crate"]}','Race exact crate','NBL',12,
              '{ids["business"]}');
      insert into public.products(
        id,name,bottles_per_crate,full_crate_price,bottles_returnable,
        bottle_type,crate_type_id,business_id)
       values('{ids["product"]}','Race Goldberg',12,12000,true,
              'Race Goldberg bottle','{ids["crate"]}','{ids["business"]}');
      alter table public.products enable trigger legacy_scope_business_write;
      alter table public.crate_types enable trigger legacy_scope_business_write;

      update private.business_physical_opening_gate
       set enabled=true where singleton;
      update private.business_product_stock_count_gate
       set enabled=true where singleton;
      update private.business_crate_count_gate
       set enabled=true where singleton;
      update private.business_bottle_count_gate
       set enabled=true where singleton;

      grant execute on function public.count_business_product_stock(
       uuid,uuid,uuid,numeric,numeric,integer,integer,date) to authenticated;
      grant execute on function public.count_business_empty_crates(
       uuid,uuid,uuid,integer,integer,date) to authenticated;
      grant execute on function public.count_business_empty_bottles(
       uuid,uuid,text,integer,integer,date) to authenticated;
      grant execute on function public.record_business_physical_opening(
       uuid,uuid,text,text,integer,integer,integer,date) to authenticated;
    """)
    date = "'2026-10-18'"
    business = f"'{ids['business']}'"
    product = f"'{ids['product']}'"
    crate = f"'{ids['crate']}'"
    bottle = "'Race Goldberg bottle'"

    competing(
        "drink",
        f"public.record_business_physical_opening({business},'{ids['drink_opening']}',"
        f"'drink',{product},2,0,12,{date})",
        f"public.count_business_product_stock({business},'{ids['drink_direct']}',"
        f"{product},0,0,0,12,{date})",
        f"select total_bottles from public.stock where product_id={product}",
        24,
    )
    competing(
        "crate",
        f"public.record_business_physical_opening({business},'{ids['crate_opening']}',"
        f"'crate',{crate},9,0,0,{date})",
        f"public.count_business_empty_crates({business},'{ids['crate_direct']}',"
        f"{crate},0,0,{date})",
        f"select quantity from public.empty_crate_stock where crate_type_id={crate}",
        9,
    )
    competing(
        "bottle",
        f"public.record_business_physical_opening({business},'{ids['bottle_opening']}',"
        f"'bottle',{bottle},15,0,0,{date})",
        f"public.count_business_empty_bottles({business},'{ids['bottle_direct']}',"
        f"{bottle},0,0,{date})",
        f"select quantity from public.empty_bottle_stock "
        f"where business_id={business} and bottle_type={bottle}",
        15,
    )
    assert checked("select count(*) from public.sales") == "0"
    assert checked("select count(*) from public.money_owed") == "0"
    print("Physical-opening versus ordinary-zero-count races passed")
finally:
    checked(f"""begin;
     set local session_replication_role=replica;
     do $clean$
     declare r record;
     begin
      for r in select * from private.legacy_scope_tables() loop
       execute format('delete from %I.%I where business_id=$1',
         r.schema_name,r.table_name) using '{ids["business"]}'::uuid;
       execute format('update %I.%I set business_id=null where business_id=$1',
         r.schema_name,r.table_name)
         using (select id from private.businesses where legacy_singleton is true);
      end loop;
     end;
     $clean$;
     delete from private.business_physical_opening_lines
      where business_id='{ids["business"]}';
     delete from private.business_product_stock_counts
      where business_id='{ids["business"]}';
     delete from private.business_empty_crate_counts
      where business_id='{ids["business"]}';
     delete from private.business_empty_bottle_counts
      where business_id='{ids["business"]}';
     delete from private.business_memberships
      where business_id='{ids["business"]}'
        or business_id in (select id from private.businesses
                          where legacy_singleton is true);
     delete from private.legacy_write_scope_gate
      where business_id in (select id from private.businesses
                            where legacy_singleton is true);
     delete from private.shop_owner where user_id='{ids["legacy"]}';
     delete from private.businesses
      where id='{ids["business"]}' or legacy_singleton is true;
     delete from auth.users where id in('{ids["legacy"]}','{ids["actor"]}');
     update private.business_physical_opening_gate
      set enabled=false where singleton;
     update private.business_product_stock_count_gate
      set enabled=false where singleton;
     update private.business_crate_count_gate
      set enabled=false where singleton;
     update private.business_bottle_count_gate
      set enabled=false where singleton;
     revoke execute on function public.count_business_product_stock(
       uuid,uuid,uuid,numeric,numeric,integer,integer,date) from authenticated;
     revoke execute on function public.count_business_empty_crates(
       uuid,uuid,uuid,integer,integer,date) from authenticated;
     revoke execute on function public.count_business_empty_bottles(
       uuid,uuid,text,integer,integer,date) from authenticated;
     revoke execute on function public.record_business_physical_opening(
       uuid,uuid,text,text,integer,integer,integer,date) from authenticated;
     commit;""")
