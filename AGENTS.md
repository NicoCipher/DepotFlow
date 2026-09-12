<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


# Drinks Wholesaler App

## Purpose

Build an extremely simple mobile-first sales and stock app for a Nigerian drinks wholesaler.

The primary user is one shop owner.

This is not an ERP, accounting package, warehouse management system, or generic POS.

The software must adapt to how the shop already works.

## Primary design rule

Complex business rules may exist underneath.

The user interface must remain extremely simple.

When choosing between:

* technically elegant but harder to understand
* slightly less abstract but obvious to the shop owner

prefer the obvious solution.

Normal actions should be fast.

Exceptions may require additional steps.

## User

V1 has one authenticated owner.

Do not implement:

* employees
* staff roles
* permissions
* multi-branch support
* customer accounts
* customer login

Customers are records inside the owner's system.

## Language

Use ordinary shop language.

Prefer:

* Stock
* Record Sale
* Customer
* Money Owed
* Crates Owed
* Bottles Owed
* Still Owing
* Paid
* Add Stock
* Empty Crates
* Empty Bottles

Avoid unnecessary accounting or technical terms such as:

* inventory
* accounts receivable
* ledger
* debit
* credit
* journal
* SKU
* transaction
* purchase order

## UX principles

This app will primarily be used on a phone.

Requirements:

* mobile first
* large touch targets
* very little typing
* plain English
* strong visual hierarchy
* product image + short product name
* one screen should generally have one main job
* important actions reachable with one hand
* no dense tables on mobile
* no unnecessary confirmation dialogs
* preserve the user's work when navigating backward
* before a sale is saved, its contents must remain editable

The owner should rarely need instructions to understand a screen.

## Core V1 areas

1. Home
2. Record Sale
3. Customers
4. Stock
5. Products

Do not expand V1 without a concrete business reason.

## Record Sale

Target normal flow:

Choose customer
→ Add drinks
→ Continue adding different drinks
→ Check empties
→ Enter payment
→ Review
→ Save sale

A customer usually buys several different products in one sale.

After adding one product, return immediately to the products screen so another can be added.

Do not force the user to complete the sale after one product.

## Products

Every exact sellable drink/size is a separate product.

Examples:

* Guinness Big
* Guinness Small
* Trophy Big
* Smirnoff Big
* Smirnoff Small

Do not automatically expose variants the business does not sell.

Each product may have:

* name
* size
* image
* bottles per crate
* full crate price
* half-crate price
* quarter-crate price
* bottle price
* stock quantity
* whether bottles are returnable

Prices use Nigerian naira.

Practical prices are normally in ₦50 increments.

Do not use decimal currency.

## Quantity model

The shop sells flexible quantities.

Examples:

* 1 crate
* 1½ crates
* 1¾ crates
* 2 crates + 5 bottles
* 9 bottles
* 13 crates

Do not model quantity as only a small fixed list of preset buttons.

The UI may offer common shortcuts but must also make arbitrary quantities easy.

Use bottles as the smallest internal stock unit where useful.

Example:

If a product has 12 bottles per crate:

1½ crates = 18 bottles

1¾ crates = 21 bottles = 1 crate + 9 bottles

Display quantities naturally to the user rather than forcing everything to be shown as bottles.

## Stock rules

A sale must never create negative stock.

Out-of-stock products should:

* remain visible
* clearly show "Out of stock"
* not be selectable for adding to the order

When stock is limited:

* show the available quantity naturally
* prevent selecting more than available
* disable increment controls at the maximum
* reject typed quantities above available stock

Use simple wording such as:

"That is all that is in stock."

Stock validation must also happen server-side/database-side, not only in the UI.

## Editing an order

Until Save Sale:

* items may be added
* quantities may be changed
* items may be removed

Customer changes of mind are normal.

Never require restarting a sale because an item changes.

## Empties

Track separately:

1. full drinks stock
2. empty crates physically in the shop
3. empty bottles physically in the shop
4. crates customers owe
5. bottles customers owe

Do not merge these concepts.

### Full crate rule

Only full-crate quantities create crate obligations.

Example:

2½ crates creates 2 crate obligations, not 2½.

### Bottle rule

Returnable bottles may create bottle obligations for:

* full crates
* half crates
* quarter crates
* loose bottles

Example:

If a 12-bottle product is sold as half a crate, 6 returnable bottles went out.

## Normal empties flow

Do not ask detailed crate/bottle questions on every normal sale.

Prefer:

"Did they bring all the empties?"

* Yes, all
* No / Some missing

If all returned:
continue immediately.

Only ask for more detail when quantities do not tally.

## Empty presentation

The owner naturally thinks about empties using brewery families such as:

* NB
* Guinness
* Trophy

Use those simple labels in owner-facing screens.

Internally, exact empty types may still be stored when required.

Presentation family and compatibility rules are not necessarily the same concept.

## Compatibility

Some empty crates can substitute for others.

Some bottle types can substitute for others.

Crate compatibility and bottle compatibility are independent.

Do not assume one from the other.

Compatibility should normally be invisible to the user.

Compatible returns should be accepted silently.

Only surface an exception when something does not match.

Do not invent compatibility rules.

Leave rules configurable until confirmed from the business owner.

## Customers

Minimum customer information:

* name
* phone number

Search must work by name or phone number.

Customer detail should make this immediately understandable:

Money owed: ₦X
Crates owed: X
Bottles owed: X
Deposit: ₦X

Keep these values separate.

Show recent activity/history underneath.

## Money

A customer may:

* pay in full
* pay partly
* owe money

If total is ₦86,500 and payment is ₦70,000:

Still owing = ₦16,500

Calculate this automatically.

## Data integrity

Never trust only client-side calculations for:

* stock availability
* sale totals
* debts
* stock deduction

Important writes should be atomic where practical.

Saving a sale should not leave half-updated:

* sales
* sale items
* stock
* customer debt
* empty obligations

Design schema and transactions accordingly.

## Offline direction

The app should eventually tolerate unreliable connectivity.

Do not implement a complicated offline-sync architecture until the online sale flow is stable.

Keep architecture compatible with later:

* PWA installation
* IndexedDB local queue
* background/retry synchronization

Do not introduce this complexity prematurely.

## Engineering principles

* TypeScript strict
* keep dependencies minimal
* avoid premature abstractions
* avoid microservices
* avoid Redux unless demonstrated necessary
* no GraphQL unless demonstrated necessary
* no separate backend unless demonstrated necessary
* prefer server-side validation for business invariants
* isolate business calculations into pure tested functions
* use database constraints where appropriate
* favor readable code over clever code

## UI implementation

Tailwind CSS is acceptable.

Build reusable primitives where repetition is real, but do not create a giant design system prematurely.

Use semantic component names.

Examples:

* ProductCard
* QuantityPicker
* SaleItem
* MoneyInput
* EmptyReturnCheck
* CustomerSearch

Do not create abstractions such as GenericEntityCard without a concrete reason.

## Testing priorities

Prioritize business-rule tests over visual snapshot tests.

Test especially:

* quantity conversion
* fractional crate calculations
* stock limits
* out-of-stock prevention
* editing sale quantities
* deleting sale items
* totals
* partial payment
* money owed
* crate obligations
* bottle obligations

## Working method for Codex

Before implementing a task:

1. Inspect existing relevant files.
2. Understand the current implementation.
3. Make the smallest coherent change.
4. Do not rewrite unrelated code.
5. Run relevant tests/lint/typecheck.
6. Fix failures caused by the change.
7. Summarize only:

   * what changed
   * validation performed
   * remaining blocker, if any

Do not produce long explanations unless requested.

Do not repeatedly restate this AGENTS.md in responses.

## Scope control

If a requested implementation exposes an unresolved business rule:

* do not guess silently
* isolate/configure the uncertainty where practical
* continue everything that does not depend on it

Never invent major product features simply because they are common in other POS systems.

The shop's real workflow is authoritative.
