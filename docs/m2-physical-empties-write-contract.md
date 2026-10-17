# M2 physical empties — independent business stock write contract

**Status: NO-GO for a second depot.** This is an engineering acceptance contract, not an authorization to migrate the production database.

## Reproduced defect

`public.empty_bottle_stock` has `PRIMARY KEY (bottle_type)`, not a business-qualified key. Two different depots both counting `Goldberg bottle` collide, even if both rows carry different `business_id` values. The disposable regression `supabase/tests/tenant_physical_empties_write_readiness.sql` reproduces this collision and proves the first shop's quantity is unchanged. A passing regression currently means **the limitation was correctly detected**, NOT that multi-business writes work.

`public.empty_crate_stock` has `PRIMARY KEY (crate_type_id)`, and `crate_type_id` references the shop's branded crate identity. A unique crate-type UUID is not permission to reuse a global physical-stock key. Future migrations must enforce the composite tenant relationship `(business_id,crate_type_id)` and require the corresponding tenant ownership for all writes. Keep Gulder and Heineken separate even if both have 12 pockets. Bottle stock keys must preserve exact bottle identity without merging unrelated bottles.

## Required migration sequence

1. On a **restorable production-schema clone**, audit all current stock keys, FKs, views, triggers and function definitions; collect before/after financial, stock, crate, bottle and receipt inventories. Resolve migration-history mismatch first. Never run this plan on production from the draft PR.
2. Introduce the tenant-qualified physical-stock key for bottles: `(business_id,bottle_type)`. Keep business_id nullable during legacy backfill only; do not create an escape hatch where null or another shop's business_id is accepted from browser input. After audited backfill, make business_id mandatory for write-enabled businesses. For crates, use a business-qualified unique/foreign key tied to the exact shop-owned crate type.
3. Update **every active SQL writer and reader**, not just the table keys: `save_sale_with_old_debt_payment`, `save_sale_split_tender`, `save_sale_multi_tender`, empty returns, held-empty release, stock receiving, physical empty counts, stock/activity reports and any trigger that increments, decrements, inserts or `ON CONFLICT`-upserts these balances. Each must derive the business from a verified active membership, not from an arbitrary client-supplied ID. A legacy-only function may continue using its legacy business only if its authorization and row predicate are explicit.
4. Replace bottle upserts on `ON CONFLICT(bottle_type)` with tenant-qualified upserts; add `WHERE business_id = verified_business` to reads/updates. Prevent updates that change the row's business. Use transaction locks and idempotency to protect concurrent saves; never merge one business's empties into another's.
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
