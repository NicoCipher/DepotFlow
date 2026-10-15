# DepotFlow — Real business onboarding and first-depot launch

**Status:** Product and engineering contract for review. Not built or enabled. First pilot: **Warlink Venture** (working name supplied by the user; the owner must confirm the precise spelling/legal or receipt name during setup). No test-record deletion, account transfer, or production changes are authorized by this document.

## Product goal

A real beverage-depot owner can discover DepotFlow, create an independent personal login, set up their shop without developer intervention, enter accurate opening quantities/debts, and complete their first real sale. The same journey must work for the pilot and every subsequent business; **no manually seeded owner ID, hidden admin step, or database edits as normal onboarding**.

The current app is owner-only (`private.shop_owner` singleton, `shop_profile.id=true`), and the operational tables are not business-scoped. **It is unsafe to add public signup or a second business against those existing data-access rules.** Until tenant isolation and owner-registration APIs pass cross-business tests, onboarding remains hidden behind a disabled feature flag; no extra login is granted access to the existing shop.

## Journey (simple wording, progressive disclosure)

### 0. Welcome / registration (before business setup)

- Clear choice: **Sign in** or **Create an account** (not an employee invitation). Use a verified email + password for v1, with recoverable account identity and strong password requirements; no passwords or reset codes in DepotFlow tables.
- Confirmation via verification email; friendly expired-link, already-registered and retry handling. Only after verified identity may the server create an owner membership. Password reset and session expiry must be recoverable.
- New owners can own a business; an existing user may later join another business, without mixing data. Business creation must be idempotent, rate limited, auditable, and tied to `auth.uid()`; never trust a client-supplied owner UUID or `is_owner` flag.
- A person who doesn't finish setup signs in again and **resumes** at the last saved step. No accidental orphaned businesses or duplicate shops from a double tap.
- **Pilot owner account belongs to the dad/business operator**, using an email he controls—not a recycled testing/developer login, not a shared staff password. Owner MFA and recovery should be offered/enforced according to the launch security policy.

### 1. About your business

Primary action: **Continue**. Fields: business display/receipt name (required), address (optional during draft but confirm before receipts), contact number (confirm before receipts), logo (optional). Name spelling must be owner-confirmed; do not copy test profile automatically.
- Save the display name/address/phone independently for **that business**. Never overwrite another shop's singleton profile.
- Tell the user plainly: “These details appear on receipts.” Keep edit available after activation, with historical receipt snapshots unchanged.
- Optional “Do this later” for logo and nonessential branding. A one-person owner should not be asked to create staff accounts.

### 2. Choose your drinks and prices

Primary action: **Add drinks**. Search/select from shared master catalogue; also support a verified custom drink when missing. A product goes into **this depot's assortment**, not every shop's list.
- Each exact drink/size is separate. Confirm bottle count/crate, crate type, returnable bottle type, and selling prices before marking a product ready to sell. Purchase cost is private and optional for the first sale, clearly labelled “Cost price”; never infer it from selling price.
- Product photo from approved shared catalogue may be reused; never require camera uploads, invent images or pull arbitrary insecure hotlinks.
- If packaging metadata is unknown, let owner save the product as **Needs details**, but block sale of a quantity requiring missing details. No invented crate compatibility or empty type.
- Existing catalogue prices are suggestions, not assumptions about this business. Owner explicitly reviews prices.

### 3. Count what is already in the shop

Primary action: **Save opening stock**. Show selected drinks with simple per-product **Crates / Loose bottles**, stock displayed in natural units.
- “Opening stock” is a **snapshot of today's existing goods**, not a new delivery, sale, or recount correction. Create an idempotent, tenant-scoped opening event and set initial quantities only once, after owner review. Do not call a routine receiving RPC (could require empty crates) or ordinary stock-adjustment RPC (could mislabel the reason).
- Distinguish **Not counted yet** from **0 in stock**. Counted zero is explicit; never silently assume 0 or positive stock from test data.
- Include **empty crates physically here** and **empty bottles physically here** as separate opening inventories, by **exact crate/bottle type**. Do not turn unopened full-drink stock into empty-crate stock automatically. Each item has its own optional confirmation.
- For a new business with no existing stock, owner may start with zero stock and receive actual deliveries later, but warning makes that intentional. A selected product cannot be sold if stock is unconfirmed/unavailable.
- All opening events save `business_id`, verified `actor_user_id`, effective business date, request ID and a readable audit source. Replays never double stock.

### 4. Add customers and what they already owe

Primary action: **Add a customer**, secondary **Skip for now**. A depot can start trading without importing its full customer book. A walk-in / retail customer flow is a separate sale decision, not a fake customer created during onboarding.
- Add name and identifying contact where available; review whether phone can be genuinely optional as the current DB requires it. Never fabricate a phone number to satisfy validation. Detect possible duplicates before saving and allow later edit.
- For each customer, **starting money owed**, **crates owed by exact crate type**, **bottles owed by exact bottle type**, and **deposit held** are *separate fields*. Each nonzero starting obligation is explicitly confirmed; zero means none, blank means not entered/unknown.
- Opening balances represent what the customer already owes **as of the go-live date**, not a new sale or repayment. Do not recreate historical test receipts or use prior test sale totals as the opening amount. A customer starting at zero needs no historical payment receipt.
- Onboard only real, owner-verified data; test customers can be manually re-entered selectively or imported through a later, reviewed **preview → choose → reconcile → confirm** tool. No automatic bulk copy from the test database. Phone numbers and private balances must not appear in public PRs, logs or error reports.
- Save each starting obligation idempotently, validate allowed types, and preserve source/date/actor. No duplicate debt on resume/retry.

### 5. Review and begin selling

A brief summary with **Edit** beside every section:
- Shop identity and receipt appearance
- Drinks ready to sell vs need details
- Confirmed opening stock (drinks, empty crates, empty bottles) and uncounted items
- Number of customers with starting balances; aggregate **money owed, crates owed, bottles owed, deposits held** displayed separately (never collapsed into one cash amount)
- Go-live date, timezone **Africa/Lagos**, and reminder that old test sales are not official shop history.

A single clear **Start using DepotFlow** action:
1. Validate the live business, owner, required fields, price/packaging validity, completion of all committed starting events and idempotency.
2. Atomically mark the **business active** with an immutable activation timestamp and effective business date; double taps return the same activation.
3. Redirect to Home with a short success welcome. Do not create a fake celebratory sale or inject synthetic financial transactions.
4. Optional, unobtrusive “Record your first sale” action. Staff invitations and advanced settings are postponed.

If the owner needs to leave midway, autosave and show “Continue setting up” on their next login. Feedback should be short and disappear; a real error should remain visible until addressed. Avoid a wall of setup widgets on the main product-search screen.

## Warlink Venture pilot: clean data and genuine experience

The current shop profile uses a name similar to the intended business and has a mixture of real names with experimental transactions. Treat the **entire existing database context as a test workspace** until records are reconciled; similarity of customer names does **not** make its sales, debts, counts or receipts official.

**The preferred path** once tenant isolation exists is a **new business ID and a verified owner login**, with a fresh operational ledger and starting receipt sequence. Keep the test workspace separate and read-only for the pilot; never rename the old shop and silently relabel old test transactions as official. If a shared production DB is used, each tenant must be isolated by verified membership, tenant-aware FKs, RLS, RPC guards and storage paths. Do not create a second business now in the owner-singleton schema.

Before go-live, sit with the owner and capture: exact public business name, operating address/contact, sellable drinks and current selling prices, physical stock and empty crate/bottle counts, each real customer's money/empties owed, and today's verified starting balances. Use actual current count as the initial inventory, not old sample data. Agree whether any old **real** records should be separately reconciled/imported; if so, support with a traceable approved migration, never guessing which tests were real.

Suggested pilot order:
1. Confirm official owner and email/recovery access without asking for passwords in chat.
2. Build/verify isolated signup + business creation (M1–M3 from security plan), on an isolated environment.
3. Walk through signup as a real owner without special manual intervention; stop at any confusing step and fix it.
4. Capture and review the real opening snapshot **at a chosen cutover date**; no retroactive duplicate sales.
5. Activate only after two-business isolation tests, backup/recovery check, checkout/receipt/stock/empties/debt tests, and owner approval.
6. Conduct **one real low-risk sale**, compare displayed stock, price, payment, receipts, customer debts and empties with the physical/shop records; then expand daily use. Any risky error means pause real use and reconcile.

**Emergency interim alternative:** a separately provisioned isolated database/app instance can run an owner-only pilot while multi-tenant onboarding is unfinished, but it is **not** the reusable self-service experience. It needs its own backups, deployment, Auth account and careful later migration. It is not the selected path unless the owner explicitly approves this tradeoff.

## Must not happen

- “Create account” silently grants access to legacy `private.shop_owner` or anyone else's shop.
- A phone/email for a customer is auto-generated to satisfy a required field.
- A setup wizard imports test balances, fake sales or receipt history automatically.
- Recording opening stock consumes empty crates as though receiving a new shipment.
- A separate owner session or two simultaneous new accounts allow cross-business reads/writes.
- Activation before any critical step is verified, or a retry creates duplicate debts/stock/businesses.
- Platform developers silently see customers' money records or use a hidden owner backdoor.
- Launch requires employee invites, accountancy knowledge or a long training session.

## Product dependencies and delivery order

1. Review the Phase 1 access/security matrix (PR #80) and M1 foundation (PR #81).
2. Implement business tenant ID + verified owner registration, isolation of all operational tables/RPCs and media, session revocation and private catalogue rules. No public signup until tested.
3. Implement setup state, owner-only draft business, resumable steps and explicit onboarding opening snapshot APIs.
4. Build the mobile-first guided UI; test at 320px, normal phones, tablets, desktop and slow/lost internet.
5. Regression tests for idempotency, unknown stock, opening balances, exact empties, duplicate customer names, historical receipts, cross-business requests, and fallback/recovery.
6. Real pilot acceptance and approved production release. No Vercel preview deployments, no changing the current test account during development.

This is a *requirements contract*. Nothing described above claims to have been implemented.
