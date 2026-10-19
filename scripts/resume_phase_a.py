#!/usr/bin/env python3
"""Manual-only DepotFlow Phase A resume; pinned source, fail-closed history."""
import argparse
from datetime import datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit, parse_qs

SHA = "7181bae6585f98473f878bd798fae81f73b4f5db"
PROJECT = "coyivbklakhilpcqqrzg"
APPROVAL = "DEPLOY_53_PHASE_A_MIGRATIONS"
HISTORICAL = 56
TOTAL = 65

def stop(reason):
    raise RuntimeError(reason)

def psql(sql):
    env = os.environ.copy()
    uri = env.get("PGDATABASE", "")
    parsed = urlsplit(uri)
    if parsed.scheme not in ("postgres", "postgresql") or PROJECT not in parsed.netloc:
        stop("Missing/wrong production database URL. Use the approved Supabase project only.")
    if parse_qs(parsed.query).get("sslmode") != ["require"]:
        stop("Database connection must specify sslmode=require")
    run = subprocess.run(
        ["psql", "-X", "-w", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"],
        input=sql, text=True, capture_output=True, timeout=180, env=env
    )
    if run.returncode:
        # Do not expose SQL bodies or production connection strings in CI logs.
        stop("Database command failed; stopped without retry. Inspect the remote ledger independently.")
    return run.stdout.strip()

def ledger():
    out = psql("""SELECT coalesce(json_agg(json_build_object('version',version,'name',name)
        ORDER BY version),'[]'::json)::text FROM supabase_migrations.schema_migrations;""")
    result = json.loads(out)
    if not isinstance(result, list):
        stop("Invalid production migration ledger")
    return result

def health():
    out = psql("""SELECT json_build_object(
      'auth_users',(SELECT count(*) FROM auth.users),
      'owner_accounts',(SELECT count(*) FROM private.shop_owner o JOIN auth.users u ON o.user_id=u.id),
      'legacy_business',(SELECT count(*) FROM private.businesses WHERE legacy_singleton AND status='active'),
      'owner_members',(SELECT count(*) FROM private.business_memberships WHERE member_kind='owner' AND status='active'),
      'closed_signup',(SELECT count(*) FROM private.business_auth_signup_gate WHERE singleton AND enabled=false),
      'catalogue',(SELECT count(*) FROM public.product_catalogue),
      'customers',(SELECT count(*) FROM public.customers),
      'sales',(SELECT count(*) FROM public.sales),
      'stock',(SELECT count(*) FROM public.stock))::text;""")
    current=json.loads(out)
    expected={"auth_users":1,"owner_accounts":1,"legacy_business":1,"owner_members":1,
              "closed_signup":1,"catalogue":45,"customers":0,"sales":0,"stock":0}
    if current != expected:
        stop("Auth/owner/signup/catalogue/test-data invariants changed; manual review required")
    return current

def inventory(candidate):
    candidate=candidate.resolve()
    actual_sha=subprocess.run(["git","-C",str(candidate),"rev-parse","HEAD"],
        check=True,capture_output=True,text=True).stdout.strip()
    if actual_sha != SHA:
        stop("Unreviewed candidate SHA")
    def read(path):
        return json.loads((candidate/path).read_text(encoding="utf-8"))
    previous=read("supabase/tests/fixtures/production_migration_history_20261019_after_auth.json")
    source=read("docs/m2-forward-only-release-inventory-20261019.json")
    locked=read("supabase/tests/fixtures/m2_forward_only_sources_20261019.json")
    names=locked.get("canonical_phase_a_target_filenames",[])
    paths=source.get("phase_a_source_migrations",[])
    phase_b="supabase/migrations/20261018124000_finalize_legacy_creation_api_cutover.sql"
    if len(paths)!=TOTAL or len(names)!=TOTAL or len(set(names))!=TOTAL:
        stop("Expected exactly 65 unique source and target migration files")
    if source.get("phase_b_separately_authorized_source")!=phase_b or locked.get("phase_b_target_filename","MISSING") is not None:
        stop("Phase B must be separately authorized and excluded")
    if source.get("already_applied_auth_source") in paths or phase_b in paths:
        stop("Disallowed migration included in Phase A")
    if locked.get("source_migrations") != [Path(p).name for p in paths] + [Path(phase_b).name]:
        stop("SQL source manifest mismatch")
    if source.get("release_authorized") is not False or source.get("phase_a_version_start")!="20261019140000":
        stop("SQL inventory drift")
    versions=previous.get("versions",[])
    if len(versions)!=HISTORICAL or versions[-1]!="20261019132131":
        stop("Historical ledger lock drift")
    expected=[{"version":v,"name":previous["names"][v]} for v in versions]
    start_time=datetime.strptime(source["phase_a_version_start"], "%Y%m%d%H%M%S")
    stages=[]
    for idx,(path,filename) in enumerate(zip(paths,names)):
        original=re.fullmatch(r"supabase/migrations/\d{14}_([a-z][a-z0-9_]*)\.sql",path)
        canonical=re.fullmatch(r"(\d{14})_([a-z][a-z0-9_]*)\.sql",filename)
        if (not original or not canonical or canonical.group(2)!=original.group(1)
                or canonical.group(1)!=(start_time+timedelta(seconds=idx)).strftime("%Y%m%d%H%M%S")):
            stop("Canonical SQL stage identity/order drift")
        file=(candidate/path).resolve()
        if not file.is_relative_to(candidate) or not file.is_file():
            stop("SQL file absent or outside candidate checkout")
        sql=file.read_text(encoding="utf-8")
        start=list(re.finditer(r"(?im)^\s*begin\s*;\s*$",sql))
        end=list(re.finditer(r"(?im)^\s*commit\s*;\s*$",sql))
        if len(start)!=1 or len(end)!=1 or start[0].end()>end[0].start() or sql[end[0].end():].strip():
            stop("Stage not one standalone SQL transaction: "+filename)
        stages.append({"version":canonical.group(1),"name":canonical.group(2),
          "sql":sql,"begin":start[0].end(),"commit":end[0].start(),
          "digest":hashlib.sha256(sql.encode("utf-8")).hexdigest()})
        expected.append({"version":canonical.group(1),"name":canonical.group(2)})
    return expected,stages

def progress(expected, actual):
    if len(actual)<HISTORICAL+12 or len(actual)>len(expected) or actual!=expected[:len(actual)]:
        stop("Production migration versions/names/count differ from locked release")
    return len(actual)-HISTORICAL

def make_transaction(stage,last,count):
    sql=stage["sql"]; version=stage["version"]; name=stage["name"]
    delimiter="$depotflow_source_"+stage["digest"][:24]+"$"
    if delimiter in sql:
        stop("SQL source delimiter collision")
    guard=f"""
SET LOCAL lock_timeout='5s';
LOCK TABLE supabase_migrations.schema_migrations IN SHARE ROW EXCLUSIVE MODE;
DO $depotflow_gate$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>{count}
 OR (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'{last}'
 OR (SELECT count(*) FROM auth.users)<>1
 OR (SELECT count(*) FROM private.shop_owner)<>1
 OR (SELECT count(*) FROM private.business_auth_signup_gate WHERE singleton AND enabled=false)<>1
 THEN RAISE EXCEPTION 'Phase A precheck failed at {version}'; END IF;
END; $depotflow_gate$;
"""
    post=f"""
INSERT INTO supabase_migrations.schema_migrations(version,name,statements)
VALUES ('{version}','{name}',ARRAY[{delimiter}{sql}{delimiter}]::text[]);
DO $depotflow_post$ BEGIN
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>{count+1}
 OR (SELECT max(version) FROM supabase_migrations.schema_migrations)<>'{version}'
 OR (SELECT count(*) FROM auth.users)<>1
 OR (SELECT count(*) FROM private.shop_owner)<>1
 OR (SELECT count(*) FROM private.business_auth_signup_gate WHERE singleton AND enabled=false)<>1
 THEN RAISE EXCEPTION 'Phase A postcheck failed at {version}'; END IF;
END; $depotflow_post$;
"""
    return sql[:stage["begin"]]+guard+sql[stage["begin"]:stage["commit"]]+post+sql[stage["commit"]:]

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--candidate",type=Path,required=True)
    parser.add_argument("--mode",choices=("preflight","deploy"),required=True)
    parser.add_argument("--approval",default="")
    args=parser.parse_args()
    if os.getenv("GITHUB_REF")!="refs/heads/main" or os.getenv("GITHUB_EVENT_NAME")!="workflow_dispatch":
        stop("Only manual dispatches against main are permitted")
    expected,stages=inventory(args.candidate)
    done=progress(expected,ledger())
    health()
    print(f"Verified 56 historic + {done}/65 Phase A. Next stage {done+1 if done<TOTAL else 'none'}.",flush=True)
    if args.mode=="preflight":
        print("PRE-FLIGHT ONLY — no write executed.")
        return 0
    if args.approval!=APPROVAL:
        stop("Explicit deployment confirmation missing")
    for idx in range(done,TOTAL):
        stage=stages[idx]
        last=expected[HISTORICAL+idx-1]["version"]
        print(f"Applying {idx+1}/65 {stage['version']} source_sha256={stage['digest'][:12]}",flush=True)
        psql(make_transaction(stage,last,HISTORICAL+idx))
        if progress(expected,ledger())!=idx+1:
            stop("Post-migration ledger mismatch; stop.")
        health()
        print(f"Verified {idx+1}/65",flush=True)
    print("Phase A complete. Independently validate managed Auth, permissions and app before merging.")

if __name__=="__main__":
    try:
        sys.exit(main())
    except (RuntimeError,ValueError,KeyError,OSError,subprocess.SubprocessError) as e:
        print("PHASE A STOPPED: "+str(e),file=sys.stderr)
        sys.exit(2)
