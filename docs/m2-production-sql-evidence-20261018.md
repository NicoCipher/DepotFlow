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
| Byte-for-byte identical applied SQL (subset of 40) | 25 |
| All 55 confirmed equivalent? | **NO** |

For 11 same-timestamp migrations, 2 SQL texts are byte-identical and 9 match after rejoining individual recorded statements with semicolons and removing whitespace. For 31 one-to-one filename-suffix candidates with different timestamps, 23 are byte-identical, 4 match after semicolon/whitespace normalization and 2 additional matches were established after removing line comments. The remaining **2 name candidates are not equal** even with line comments removed. Altogether, **25 exact + 15 normalized-only = 40**.

**Normalization caveat:** the lexical comparison removed whitespace globally, including inside quoted literals, and sometimes stripped line comments. It is useful high-confidence source-mapping evidence, but **not a rigorous SQL-parser-based semantic equivalence proof**, an actual-schema comparison, or proof that runtime Supabase/Auth configuration matches. Applied order and DDL dependencies still require an isolated real-schema clone. No timestamp was renamed or migration history repaired.

## Two same-name migrations requiring line-by-line investigation

1. **Live `20260927154550_customer_archiving`** maps to local `20260926224656_customer_archiving.sql`. The local SQL contains a trailing `REVOKE ALL ON FUNCTION private.save_sale(uuid,uuid,date,numeric,jsonb) FROM public,anon,authenticated;` before COMMIT. That revocation is **absent in the recorded applied live SQL**. Confirm the current actual function and EXECUTE grants read-only (a later migration could independently revoke it) before drafting a forward-only security repair.
2. **Live `20261014072834_sale_with_old_debt_payment`** maps by name to `20261014110000_sale_with_old_debt_payment.sql`, but their SQL bodies differ materially: live starts with an atomic old-debt and sale saver, while the repository candidate includes receipt-snapshot setup. Do **not** treat these as alternate timestamps for equivalent migrations.

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
