# DepotFlow: drinks in the shop and physical crate identity

## One rule per real-world thing

1. **Master catalogue** — describes a drink the shop might sell. Removing a drink from the shop must not delete this shared entry.
2. **Shop drink** (`products.id`) — the exact size/variant the business has configured and can sell. `is_active=false` hides it from new sales; it does not delete its history, stock, price setup or catalogue link. Restore the same ID instead of duplicating it.
3. **Physical empty crate** (`crate_types.id`) — a countable real crate identity, not merely a brewery, pocket count, or drink sold in a crate. A Heineken 12-pocket crate and a Gulder 12-pocket crate keep different IDs and separate stock counts when physically identifiable.
4. **Brewery family** (`empty_family`) — a *display subtotal*, never a stock identity or an automatic swap permission.
5. **Customer crate obligation** — the exact crate type owed, separate from the type actually received. An approved, directional replacement reduces the original obligation and increases stock under the actually received type.
6. **Shared historical/legacy crate** — retains its original stock and customer obligations until a physically checked, auditable reconciliation says where they belong. Do not reassign or split counts by assumption.

## Removing or restoring a shop drink

- The owner must explicitly confirm **Remove from shop**.
- Removed drinks remain accessible from **Removed drinks** and their detail/history pages.
- The product's stock, customer debts, empties, receipts and sale items stay unchanged; even a positive recorded stock quantity remains accounted for. A count can still correct that physical stock.
- Removed drinks are unavailable in new checkout and delivery selection. A database trigger rejects any new sale_item for a removed drink, including a stale tab or direct RPC request.
- The product-row lock serializes an in-progress sale against removal; failed sales roll back atomically. Idempotent replay of an already saved sale returns its original result.
- Restoration is explicit and keeps the original product ID; review current price, physical stock and correct crate mapping before recording another sale.

## Fixing generic pooled crates safely

There are old `NBL 12-pocket` and `NBL 20-pocket` records used by multiple drinks. At least one of these has physical stock and customer obligations. Their names are not sufficient evidence to distribute them into 33, Life, Goldberg, Heineken or another branded ID.

Operator steps after confirming the actual depot inventory:

1. Open **Crates** and follow **Shared crate identities need review** to inspect each affected drink.
2. Create the separately identifiable branded physical crate types that actually exist.
3. Reassign each *current product* to its correct branded crate type; verify pocket counts. Do **not** rewrite existing sale receipts/history.
4. Physically recount the old pooled crates and the newly branded crates. Reconcile each count, ensuring the same physical crate appears in exactly one counted category.
5. Keep historical customer obligations under the originally owed ID until an owner-approved reconciliation workflow adjusts them with a recorded audit event. Never silently rewrite customer debts.
6. Configure allowed replacements **direction by direction**. Matching brewery or pocket size alone permits no replacement.
7. Only discard a never-used crate setup when the database confirms it has no references whatsoever; records with any stock, history, obligations or rules must be retained.

## Follow-up for multi-business onboarding

This PR's owner-only RPC follows the existing V1 singleton owner permission boundary. Before enabling independent signup for Walnik or future businesses, adapt the RPC and sale-trigger authorization to the tenant-aware ownership and product/business scope in the staged multi-business rollout. Do not open a public registration route using this singleton shop data.
