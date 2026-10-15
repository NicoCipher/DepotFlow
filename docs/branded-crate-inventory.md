# Branded empty crates: operating and migration rules

DepotFlow records exact branded physical crate identities, while showing manufacturer
(brewery) subtotals and one depot grand total. Compatible does **not** mean identical.

## Rules

- Create one exact crate identity for each identifiable branded physical crate.
  Example: Big Heineken 12-pocket and Gulder 12-pocket are different IDs.
- Assign every product to its correct crate ID. A product is not an empty-crate
  stock line: multiple product variants can reference the exact same branded
  physical crate **only when that is genuinely the same identity**.
- `empty_family` is the brewery label. It is only used for navigation and
  subtotals. A group or equal pocket count never creates a replacement rule.
- `crate_swap_rules` is explicit and directional. Configure both directions only
  when Walnik confirms both are allowed. The current sale and later return
  paths check the configured rules.
- Always increase physical empty-crate stock under the returned branded type,
  even when it settles another branded crate obligation.
- Bottle returns remain a separate exact-type obligation, so swapping an empty
  crate does not quietly settle bottles the customer still owes.
- A null first count means **not counted**; it is not zero. The recorded total
  must be labelled incomplete while such types exist.

## Examples to confirm during real Walnik setup

- NBL: 33, Life, Goldberg, Gulder, and Heineken must have their own branded
  identities and stock counts; same-size or interchangeable crates do not
  collapse those counts.
- International Breweries: Trophy, Castle Lite, and Trophy Stout can share
  a physical crate design. Keep each branded identity if it can be identified
  and physically counted. Set permitted substitutions separately.
- Guinness and every other brewery follow the same rules.
- Do not guess from a brand name whether two empty *bottles* are compatible.

## Existing data and onboarding

**No automatic backfill, stock split, or historical rewrite.**

1. Review Products → each assigned crate and Crates → each exact identity.
2. Create any missing branded crate IDs and select the right identity on each product.
3. If an old pooled crate type was counted, physically reconcile it when setting
   the new branded counts. Review and correct its old count too; otherwise the
   depot total may count the same crates twice.
4. Record opening counts for each new physical branded crate. Leave genuinely
   unknown counts as not counted; never make up a distribution.
5. Configure only owner-approved directional swaps (and separate bottle rules).
6. Recheck customer obligations and opening balances against the physical count
   before business onboarding.

This feature does not merge legacy obligations or old crate stock. Existing
read-only sale history continues to reference original crate IDs. Corrections to
existing customer obligations need a separately reviewed, auditable workflow.
