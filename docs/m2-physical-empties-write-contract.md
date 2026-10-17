# M2 physical empties — independent business stock write contract

**Status: NO-GO for a second depot.** This is an engineering acceptance contract, not an authorization to migrate the production database.

## Defect reproduced in live schema; key change staged in the draft

**Production still has `PRIMARY KEY (bottle_type)`.** Two different depots counting `Goldberg bottle` would collide. Do not sign up another depot on that schema.

**Unmerged draft PR #107** now includes `20261017140200_tenant_physical_empty_stock_key.sql`. In disposable PostgreSQL 16 it adds an immutable surrogate physical-stock row ID and `UNIQUE NULLS NOT DISTINCT (business_id,bottle_type)`, preserving the one-row-per-type legacy NULL key during audited backfill. It retargets the original shop's two active bottle upserts (atomic sale, customer empty return) to the composite key without rewriting financial or receipt logic.

`supabase/tests/tenant_physical_empties_write_readiness.sql` now proves the original shop and two independent depots can hold **3, 4 and 9 Goldberg empty bottles**, respectively, and their owners see only their own quantities. Revoked owner reads are rejected and new-depot writes remain prohibited. The full disposable SQL and concurrency suite has passed; **this does not grant checkout to new businesses**.

`public.empty_crate_stock` is keyed on `crate_type_id`, which is an exact shop-owned UUID. M2c already adds the matching `(business_id,crate_type_id)` foreign key to a shop-scoped crate type; do not share crate UUIDs between businesses or substitute Gulder for Heineken merely because both have 12 pockets. An independently reviewed new-business crate count/return/receiving writer is still required.

## Required migration sequence

1. On a **restorable production-schema clone**, audit all current stock keys, FKs, views, triggers and function definitions; collect before/after financial, stock, crate, bottle and receipt inventories. Resolve migration-history mismatch first. Never run this plan on production from the draft PR.
2. Verify the staged tenant-qualified physical-stock key for bottles: `(business_id,bottle_type)`. Keep business_id nullable during legacy backfill only; do not create an escape hatch where null or another shop's business_id is accepted from browser input. After audited backfill, make business_id mandatory for write-enabled businesses. For crates, retain the business-qualified foreign key tied to the exact shop-owned crate type.
3. Update **every active SQL writer and reader**, not just the table keys: `save_sale_with_old_debt_payment`, `save_sale_split_tender`, `save_sale_multi_tender`, empty returns, held-empty release, stock receiving, physical empty counts, stock/activity reports and any trigger that increments, decrements, inserts or `ON CONFLICT`-upserts these balances. Each must derive the business from a verified active membership, not from an arbitrary client-supplied ID. A legacy-only function may continue using its legacy business only if its authorization and row predicate are explicit.
4. The two original shop bottle upserts are retargeted in the draft; additionally scope every new-business stock reader/upsert by verified business identity before enabling it. Prove that the row identity cannot be reassigned, audited NULL-to-legacy backfill is the sole exception, and concurrency/idempotency never merges businesses' empties.
5. Assert on a disposable database with **two authenticated business owners and one revoked owner**:
   - A and B each hold 4 and 9 `Goldberg bottle` empties; both see their own counts; neither sees or edits the other's.
   - A's bottle return, held release and count cannot change B's quantities; foreign identifiers are indistinguishable from missing identifiers.
   - A and B each have independent branded crate counts, including non-interchangeable Gulder/Heineken crates and explicitly shared 33/Life/Goldberg crate rules within each business.
   - Sale + old debt + mixed payment + exact empties save is atomic and idempotent per business. A retry or uncertain response cannot double-post. Receipts and audit history remain attached to the correct business.
   - Legacy Walnik TEST data, existing sale request IDs and receipt links remain intact.
6. Only after those tests, repeat on a real-schema clone and inspect migration locks, policy behavior, and rollback/forward recovery. Keep signup and nonlegacy operational writes **disabled** until approved.

## Safety gates

- A successful CI run on the current draft does not unlock production.
- A fixed bottle key alone does not unlock production; legacy RPCs still use singleton assumptions.
- Never create the official Walnik Ventures business by copying the TEST shop. Official onboarding and atomic opening balances are a separate gated release.
- The release preflight in `check_tenancy_release_order.py` must pass against **fresh** remote history before any DDL. Do not bypass it with migration repair or `--include-all`.
