# Real-business onboarding: launch checklist and acceptance scenarios

**Working product example:** Warlink Venture (confirm spelling, receipt name, address and owner-controlled login inside setup). **No test data may be presumed real.**

## Staged launch gates

| Gate | Required evidence before proceeding | If it fails |
| --- | --- | --- |
| A. Personal account | User verified email; signed in and recovers sessions; no manual DB owner registration; no account leakage | Block new shop creation |
| B. Business isolation | Active membership business-scoped; no data from test shop or any other shop visible through page, RPC, DB table, image path or URL | Block all registrations and activation |
| C. Catalogue/prices | Shop assortment independent; prices explicitly confirmed; unknown crate metadata clearly flagged; costs not exposed | Block affected product's sale |
| D. Initial stock | Drinks/empty crates/empty bottles counted or intentionally omitted, all exactly typed, dated, retriable, without receiving-stock side effects | Block activation if a supposedly available product lacks a validated count |
| E. Customer opening records | No fake customer fields; money, deposit, crate and bottle obligations distinct; no duplicate opening debts on retries | Block affected customer balance and sale |
| F. Review | Owner sees and explicitly confirms opening totals, activation date and receipt identity; no silent test-data import | Keep business draft |
| G. Sales gate | Normal sale/partial payment/old debt settlement/returns/receipt verification/atomic save checks pass end to end | Stop go-live, keep test shop unchanged |
| H. Recovery and operation | Owner can resume signup/setup after network loss, reset password, recover login, and access support without exposing secrets | Do not onboard externally |

## Acceptance tests written in the shopkeeper's language

| Situation | What must happen |
| --- | --- |
| Owner chooses “Create an account,” enters email | Clear email verification message, no access before verification |
| Owner verifies and taps Create Business twice | Exactly one business and owner membership; no duplicated setup |
| Owner leaves midway, comes back tomorrow | Returns to last completed setup step with data saved |
| Owner enters receipt name “Warlink Venture” | That business displays exactly the owner-confirmed name; no inherited name from test account |
| A different owner registers a separate depot | Completely isolated owner membership, shop data, catalog pricing, stock, customers and receipts; no V1 business switching |
| Owner selects Goldberg from master catalogue | Adds to **this** business; does not change another shop's prices or product list |
| Owner saves product with missing bottle/crate type | Honest “Needs details” state, no fake empty type and cannot sell invalid configured units |
| Owner counts 3 crates and 4 bottles before opening | **Editable draft** recorded; nothing added to live stock until final activation; no phantom receiving or empty movement |
| Owner leaves a drink uncounted | It remains “Not counted,” not misleading “0 in stock” |
| Owner explicitly counts zero | Shows “Out of stock,” not “Not counted” |
| Owner confirms 5 exact empty crates in shop | Records real physical empty-crate opening inventory; no generated customer obligation |
| Owner reopens setup and corrects a counted quantity | Updates the versioned draft only, and review reflects the new quantity; activation creates exactly one opening event for final value |
| Owner tries activation from a stale setup tab | Rejected with a clear refresh/review message; no partial stock postings |
| Owner retries activation after a connection failure | Original completion returned safely; no duplicate stock or debts |
| Owner adds a real customer with ₦12,000 starting debt | Shows starting amount as money owed; does not invent historical sale |
| Customer owes 2 crates of Type A and 3 bottles of Type B | Distinct obligations preserved, no substitution by family |
| Customer has an existing deposit | Deposit held recorded separately and not silently treated as income or debt |
| Network fails while saving customer's starting money, deposit and empties | No partial customer opening ledger: all values remain one complete draft until a single atomic activation commit |
| Owner tries to activate a customer with missing crate/deposit review | Activation fails with the incomplete customer's name and missing section; does not post money only |
| Existing test account has customer with same name | No auto-import, no association without explicit owner verification |
| Owner begins selling without any existing customers | Can use supported sale/customer flows without setting up a customer book first |
| User has no customer phone number | Save a real customer with `phone=NULL` after tested schema/domain migration; no fabricated number; detect possible duplicate names. Block onboarding release if schema is still phone-required |
| Owner checks setup total and taps Start twice | One activation time/date, one set of opening events, one receipt sequence |
| First real sale uses only part payment | Correct sale total, collected, still owing, stock and receipt |
| First sale includes old-debt payment | One visit in All Records, original sale and payment receipts separately auditable, no double count |
| Customer returns some empties | Exact whole-crate obligations and bottle obligations updated; unknown types rejected |
| Connection fails during Save Sale | Check Sale/uncertain-save recovery; retry cannot create second sale |
| Another user guesses owner/customer/receipt IDs | No access to tenant-private data; a token can only verify the specific receipt, never the customer's wider account |
| Someone forwards a valid receipt verification link | Anonymous response contains **only** receipt number, shop name, business date, kind, status and sale total or payment amount; no customer, phone, line items, balances, account, costs, internal IDs or shop address |
| Old sale, partial sale, payment and voided receipt tokens | Each receives the same strict anonymous allowlist; every forbidden field absent, not simply null |
| Owner signs out and signs back in | Returns to their business dashboard; active business identity visible and unambiguous |
| Owner loses password but still controls verified email | Standard recovery restores access; new sessions are authenticated and previous sessions revoked as required |
| Owner loses MFA device but retains saved recovery code and verified email | One-time recovery code restores access through a controlled process; reuse fails and sessions rotate |
| Sole owner loses access to email and MFA | No automatic ownership takeover; high-assurance support case requires independent business proof, two independent reviewers, notification/cooling-off and full audit; unverified claim denied |
| Staff or platform operator tries to take over a depot using a recovery URL | Blocked; no hidden admin membership or bypass of business isolation |
| New business setup is incomplete | Public links do not expose any partial customer/financial data |

## Owner recovery acceptance gate

Before opening signup, implement and verify: owner-controlled verified email, one-time hashed recovery codes, optional second channel, standard reset and lost-MFA recovery, high-assurance lost-email review with two independent approvers, old-contact notification, cooling-off period, audit of ownership evidence, and immediate previous-session revocation on approval. Support must never ask for the password or a recovery code in chat. If verification is impossible, preserve data and deny takeover rather than transferring ownership.

## UI acceptance — no training needed

- On a phone, one clear primary button per screen; progress is easy to understand but consumes little room.
- Instructions use “Drinks,” “Stock,” “Customers,” “Money owed,” “Crates owed,” and “Bottles owed”; do not expose tenant ID, UUID, RLS, schema, migrations or receipt internals.
- Give a strong, brief saved/success confirmation. Validation tells the owner **what to fix and where**; important errors persist, temporary feedback disappears.
- Large tap targets, legible totals and numbers, appropriate keyboard for money/phone/quantity, back/edit always preserves earlier entries.
- Avoid a huge catalogue checklist: search is prominent, selected drinks are obvious and persistent, and the first sale is reachable after activation.
- Sign-up screens should not force a business owner to create staff, fill costs/margins, use a logo, or configure every drink before starting.
- Explicit **“Counted zero” vs “Not counted”** is required everywhere quantities are entered, including after reload.
- Final review groups financial quantities separately, never total money plus crates or show a misleading “₦0 owed” where a balance is unverified.
- Mobile (320–430px), tablet and laptop checked, including keyboard, screen reader, poor connectivity and full-page reload.

## V1 scope rule

Self-serve signup creates one independent business per newly registered owner. Two separate owner accounts prove isolation. One account switching among multiple owned businesses, staff invitations and Team & Access are future enhancements, **not** required to activate Warlink Venture.

## Controlled Warlink Venture cutover checklist

- [ ] Verify owner-controlled email and an independently secured backup/recovery method (never share password, recovery codes or OTP in chat)
- [ ] Confirm exact public business name and receipt header, phone, physical address
- [ ] Agree an **opening date and time** in Nigeria (WAT) and that test transactions remain non-official
- [ ] Count currently available drinks by exact product/size and loose bottles
- [ ] Count physical empty crates and empty bottles by exact type
- [ ] Get actual selling prices, decide which products are active; cost prices are separately optional
- [ ] Verify each real customer and starting money owed/empty obligations/deposits; no auto-copy of test data
- [ ] Review combined opening figures with owner against notebook/physical counts
- [ ] Confirm test workspace is isolated and retained, or explicitly archived; no destructive reset
- [ ] Activate after security, database and UI tests have passed and the owner has signed off
- [ ] Observe the first small real sale, check stock/money/receipt and correct any discrepancy before routine use
- [ ] Create a clear support/restore path and a simple method of reporting problems while still operating

## Implementation breakdown (separate mergeable PRs, not one huge change)

1. **Account & business creation contracts**: owner email verification, business creation transaction, active owner membership, duplicate-create prevention, real tenant-scoped read/write security. Requires approved multi-tenant schema and negative isolation tests.
2. **Business setup state**: start/resume, step progression, safe partial save, activation/receipt identity, setup-only grants and start-business guard.
3. **Catalogue selection**: per-business assortment, optional metadata and prices, accurate blocked/ready states.
4. **Opening stock & empties**: initial snapshots by exact types, money/stock separation, no stock-receipt side effects, safe reconciliation.
5. **Customers & opening obligations**: optional import/re-entry, validated money/empties/deposits and idempotent opening events.
6. **Mobile UX and review**: unified setup flow, readiness checklist, activation and first-sale handoff; tests.
7. **Pilot launch**: disposable PostgreSQL tests; Codex/security review; owner walk-through; production deployment only after approval.

At every release gate, **no Vercel preview deployments**; continue to use isolated database tests and GitHub review. The test account and production records remain unchanged until specifically approved for a safe migration or archive.

## Explicit launch decision required

Before creating a real owner login, choose whether to:

- **Preferred:** complete true tenant-safe, self-serve onboarding, with a clean business inside DepotFlow. This is the reusable signup experience for future customers.
- **Interim only:** run a physically isolated owner-only pilot in a separate app/database project for immediate operations. This does *not* prove general signup and requires a later safe migration.

Never claim the interim workaround is already equivalent to reusable self-service registration.
