# DepotFlow M2: read-only applied-SQL comparison evidence

**Capture date:** 2026-10-18; connected live **DepotFlow** Supabase project `coyivbklakhilpcqqrzg`.
**Safety:** All database calls were SELECT-only against `supabase_migrations.schema_migrations`, comparing the recorded applied SQL `statements` arrays with SQL source files on repository `main` at `729b720`. No customer data, payments, tenant rows or credentials were read, and no live SQL was executed as a migration. **This is not a deploy permission or full schema-equivalence certificate.**

## Results

| Classification | Live migrations |
| --- | ---: |
| Live migration versions | **55** |
| Equal local version and equivalent *normalized SQL text* | 11 |
| Different timestamps, exact filename suffix, equivalent normalized SQL text | 29 |
| Different timestamps, same suffix, **different normalized SQL** | **2** |
| No unique same-name local migration candidate | **13** |
| **Total verified normalized-text matches** | **40 / 55** |
| Byte-for-byte identical applied SQL (subset of 40) | 24 |
| All 55 confirmed equivalent? | **NO** |

For 11 same-timestamp migrations, 2 SQL texts are byte-identical and 9 match after rejoining individual recorded statements with semicolons and removing whitespace. For 31 one-to-one filename-suffix candidates with different timestamps, 22 are byte-identical and 7 require lexical normalization (including comment handling). The remaining **2 name candidates are not equal** even with line comments removed. Altogether, **24 exact + 16 normalized-only = 40**.

**Normalization caveat:** the lexical comparison removed whitespace globally, including inside quoted literals, and sometimes stripped line comments. It is useful high-confidence source-mapping evidence, but **not a rigorous SQL-parser-based semantic equivalence proof**, an actual-schema comparison, or proof that runtime Supabase/Auth configuration matches. Applied order and DDL dependencies still require an isolated real-schema clone. No timestamp was renamed or migration history repaired.

## Two same-name migrations requiring line-by-line investigation

1. **Live `20260927154550_customer_archiving`** maps to local `20260926224656_customer_archiving.sql`. The local SQL contains a trailing `REVOKE ALL ON FUNCTION private.save_sale(uuid,uuid,date,numeric,jsonb) FROM public,anon,authenticated;` before COMMIT. That revocation is **absent in the recorded applied live SQL**. Confirm the current actual function and EXECUTE grants read-only (a later migration could independently revoke it) before drafting a forward-only security repair.
2. **Live `20261014072834_sale_with_old_debt_payment`** maps by name to `20261014110000_sale_with_old_debt_payment.sql`, but their SQL bodies differ materially: live starts with an atomic old-debt and sale saver, while the repository candidate includes receipt-snapshot setup. Do **not** treat these as alternate timestamps for equivalent migrations.

## Current live privilege checks (same read-only session)

A separate SELECT-only inspection of `pg_proc` and `information_schema` showed:

- `private.save_sale(uuid,uuid,date,numeric,jsonb)` **does not currently exist** in live production. The historical source difference above is real, but **does not itself establish a currently exposed RPC**; later migrations retired that signature. Recheck on the actual schema clone.
- The old `public.create_crate_type(uuid,text,text,numeric,text)` and `private.create_crate_type(...)` are executable by `authenticated` and not `anon`. Their caller-supplied ID handling remains a cross-tenant collision risk **once another depot has records**.
- `authenticated` still has `INSERT(id)` privilege on `public.products`, as well as other direct product INSERT privileges. The original shop's product editor also retains UPDATE permission. The direct selected-PK INSERT must be removed and replaced with a safe generated-ID creation path before live tenant assortment is activated.

These findings reinforce that lexical history matches do **not** establish security parity or readiness. They are not a reason to mutate live Auth/roles/grants in advance of a reviewed forward-only migration.

## Thirteen live migrations without exact suffix candidates

`20260925113009_product_images`,
`20260928180317_payment_receipts_and_activity`,
`20261001022503_join_bottled_desperados_catalogue`,
`20261014054222_master_maltina_can_packshot`,
`20261014070652_three_verified_catalogue_packshots_oct14`,
`20261014115322_upgrade_old_debt_sale_receipt_snapshot_oct14`,
`20261014115332_verify_historical_account_receipts_oct14`,
`20261016152420_split_tender_ledger_staged_20261016`,
`20261016152535_split_tender_atomic_saver_staged_20261016`,
`20261016153051_verify_split_tender_receipts_staged_20261016`,
`20261016153418_split_sale_read_only_recovery_20261016`,
`20261016162615_split_sale_request_fence_staged_20261016`,
`20261016165128_activate_cash_transfer_owner_only_20261016`.

These 13 have no single **same-named** source file. They may be splits, renames, edits, or production-only SQL. Match their **applied statements** to any source candidates only after deliberate manual review. Never manufacture version equivalence based on coincidental similarity.

## Release plan unchanged

1. Keep PR #107 DRAFT, all tenant signup/assortment/operational grants OFF.
2. Audit actual live EXECUTE grants for the legacy save_sale and crate/product creation surfaces with SELECT-only catalog queries.
3. Examine the 2 unequal mappings and 13 unmatched applied SQL records; reconstruct **actual** production migration history without changing production.
4. Only after explicit user approval for Supabase branch cost, create a separate PG17 production-schema staging clone, compare `supabase/tests/live_schema_fingerprint.sql` outputs, test forward-only migrations and representative synthetic A/B financial/tenant workflows.
5. Require all hosted Auth direct-signup and Data API tests before turning any gate ON.

**Forbidden shortcuts:** `db push --include-all`, blind migration timestamps, `migration repair`, `db reset --linked`, direct edits to live `supabase_migrations`.

## 19 October — all 55 original applied SQL entries accounted for (still NO-GO)

The above section reflects the **first** mapping audit. A second read-only comparison examined the 13 initially unnamed entries. Eleven of those have source candidates in historical repository migrations with different file names or timestamps:

- Production `payment_receipts_and_activity` matches local `20260928120000_payment_receipts.sql` byte-for-byte.
- `master_maltina_can_packshot` and `three_verified_catalogue_packshots_oct14` have lexically matching source in `20261014082000_master_maltina_photos.sql` and `20261014101000_three_verified_catalogue_packshots.sql`.
- `upgrade_old_debt_sale_receipt_snapshot_oct14` and `verify_historical_account_receipts_oct14` have byte-identical source in `20261014110000_sale_with_old_debt_payment.sql` and `20261014111000_verify_account_receipt.sql`.
- The six production split-tender stages map to the six local `20261016*` split-tender scripts: the first four have matching text after removing *local-only BEGIN/COMMIT wrappers* and whitespace; the request fence and activation stages match exactly.

**Corrected total for all 55 live entries:** **29 byte-identical**, **22 lexically matched** (SQL canonicalization, NOT proven parser-level semantic equivalence), and **4 not text-matched**. The four original applied SQL records were copied read-only into non-executable `docs/release-evidence/applied-*.sql.txt` files with MD5 checksums. They are NOT migration files. Their exact statement text is preserved so an authorized reviewer can examine it:

1. `20260925113009_product_images` — original storage bucket/policies, no unique equivalent source file.
2. `20260927154550_customer_archiving` — live SQL lacks the trailing private legacy `save_sale` revocation found in the similar local file. The old function does not presently exist on live.
3. `20261001022503_join_bottled_desperados_catalogue` — original catalogue identity merge absent locally.
4. `20261014072834_sale_with_old_debt_payment` — production's atomic prior-debt-and-sale RPC source differs from similarly named local file. That local file is in fact byte-identical to *another* later live applied migration, `20261014115322`.

Machine-readable 55-entry evidence inventory: `docs/m2-applied-sql-reconciliation-manifest-20261019.json`.

**Critically:** this reconciles the *origin/evidence trail of applied SQL*, not the **migration version history**. Production still has 55 recorded versions and the repository has many older differently numbered scripts. Do NOT run DB push, `migration repair`, replay of archived scripts, or copy files into `supabase/migrations`. The safe release mechanism must be designed and trialed on an actual-schema isolated PG17 environment, with the observed constraints/ownership/function grants and reference ledger compared against production.

## 19 October — Auth service block not yet deployed

Live read-only catalog lookup confirms both `private.depotflow_before_user_created(jsonb)` and `private.business_auth_signup_gate` are **absent on production**. The former exists only in the draft migration and its rollback-only SQL tests. App environment flags do not stop direct GoTrue signup. Hosted Before User Created hook installation, explicit disabled-state probe against a nonproduction project, email confirmation and platform signup abuse controls remain mandatory release gates. Never use a live user account as a test probe.

