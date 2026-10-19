# DepotFlow — $0 legacy creation API phased cutover (19 October 2026)

**DRAFT. NO PRODUCTION APPROVAL. Do not deploy this document as a runbook without live-schema and migration-history reconciliation.**

## Why the separation is mandatory

The deployed original-shop UI creates a customer using direct `customers.INSERT(id,...)`, creates a crate with `create_crate_type(uuid,...)`, and creates a product using direct `products.INSERT(id,...)`. The replacement UI on PR #107 instead calls the verified `create_legacy_customer`, `create_legacy_crate_type` and `create_legacy_product` RPCs, all of which generate record IDs in PostgreSQL with idempotent request tokens.

A database-first deployment that revoked the old creation paths in the same migrations that installed the replacement functions caused an unavoidable outage while the old Vercel app still served requests. Deploying the new UI first also fails before its RPCs exist. The new two-phase contract solves that ORDERING problem only; it does **not** prove production readiness.

## Phase A — database-compatible staging, no app change

- Install the replacement RPCs and strict owner guards using the reviewed staged migrations. Keep authenticated legacy `customers.INSERT(id,name,phone,...)`, `products.INSERT(...)` and the historical `create_crate_type` wrapper during the overlap. **Do not grant** `customers.INSERT(business_id)`, any new-business write RPC, or any onboarding activation.
- `private.legacy_creation_cutover_gate` is created with `authorized=false`; ordinary Auth/anonymous/service roles cannot change it.
- An old-client regression executes actual customer, crate and product creations, as well as checking the new RPC grants. The original record/receipt/stock identifiers are untouched.
- This is only a prospective plan: production migration versions still differ; no direct production migration may be applied without separate written approval and a reviewed forward-only execution plan.
- **Temporary risk boundary:** the original owner's old caller-selected UUID writes still exist during overlap. Do not activate a second depot or allow new-business customer/product creation until after Phase B. Otherwise cross-tenant UUID collision probes would remain possible.

## Vercel app cutover — operator-attended

- Verify that the exact new app build is ready, new RPC functions are present and callable by the verified original-shop owner, and older business pages still load. Keep the old build available for controlled rollback before privilege cutover.
- Deploy the new original-shop UI, while all public signup and multi-business gates remain OFF. Smoke-test creation of one synthetic or operator-approved test customer, crate and product using the replacement RPCs; verify saved IDs, exact idempotent retries and existing sales/records. **Do not create test data in production without permission.**
- Check production error logs and the original owner's confirmed login. Do not authorize Phase B until the current app has stopped using old direct customer/product inserts and the old crate-create wrapper. If the app must be rolled back before Phase B, old permissions still work.
- Deployment rollback **after** Phase B is not safe without another reviewed, explicit compatibility plan: old UI requires now-revoked creation rights.

## Phase B — independently gated final revocation

- `20261018124000_finalize_legacy_creation_api_cutover.sql` is a separate migration which **fails before changing any grant** when `private.legacy_creation_cutover_gate.authorized` is false. Default/unattended migration application therefore **stops safely**, not auto-revokes legacy creation.
- Only after approved cutover may a privileged DBA mark `authorized=true` with `authorized_at`, and then explicitly apply the reviewed post-cutover source/ledger entry. The schema gate prevents accidental SQL-first revocation; it is NOT evidence that Vercel actually cut over. Human signoff and verification remain necessary.
- In one transaction Phase B revokes all authenticated customer/product INSERT columns plus the old crate-create function entrypoints; it verifies audited owner-only replacement RPCs remain callable and customer/product edits remain intact.
- The hosted Auth Before User Created hook must be installed and verified separately, and the new-business gates must remain OFF. Neither green CI nor a SQL flag is permission to enable signup or sell from other depots.

## Disposable PostgreSQL 17 acceptance

`.github/workflows/verify-database.yml` now verifies:

1. The complete Phase A migration sequence, with default-OFF cutover gate.
2. Old-client customer, crate and product writes still work in a rollback-only authenticated test.
3. Attempting Phase B without authorization raises the specified error, leaving old permissions intact.
4. A synthetic privileged operator authorizes the gate only in the disposable runner; Phase B then succeeds.
5. Existing adversarial customer/assortment tests reject both chosen and default primary key bypasses after Phase B.
6. The full reconstructed 55-stage original history + 67-stage tenant sequence preserves the pre/post synthetic Walnik-like ledger fingerprint. This is NOT an actual production-data clone or hosted Auth certification.

## Still NO-GO

No live history-version strategy, confidential real production-schema permission parity, approved hosted Auth hook, owned production backup, cutover approval, or verified live operations. PR #107 stays Draft. The smallest safe release packaging is **staged foundation/RPC compatibility first**, followed by an explicitly signed-off app cutover, then the **separately gated final privilege revocation**. Multi-business registration and activation are later releases.
