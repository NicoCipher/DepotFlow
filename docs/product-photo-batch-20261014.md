# Full catalogue photographs — real three-image release (14 Oct 2026)

This batch improves the **entire master catalogue**, including unavailable products and products with zero stock. We staged ten exact-product photo candidates and visually inspected every downloaded WebP against its label and product packaging. The original photographs are processed into 640×800 first-party WebPs on white, with image metadata removed. No AI packaging or logo is invented.

## Approved for linking (three)

| Master name | Actual inspected variant | File | Exact source | SHA-256 |
|---|---|---|---|---|
| Turbo (NB) | Real Turbo King 60cl glass bottle, lion on red-and-yellow label, not a logo | `turbo-king-bottle-60cl.webp` | https://www.abapoprestaurant.com/brand/turbo-king/ ; image https://www.abapoprestaurant.com/wp-content/uploads/2024/01/Turbo-King-Stout-Bottle-300x300.jpg | `f2ac41d7aefc49d81535d5f32e28e96e390a2603ccf3b3f379e0b6b119ea1c92` |
| Malta Can (GN) | Original Malta Guinness 330ml can | `malta-guinness-can-original-33cl.webp` | https://www.shoppersgatestores.com/products/malta-guinness-330ml-can ; image https://www.shoppersgatestores.com/storage/drinks/www.png | `e72e4fa97773fa2d6f0871e4f1fa7b09ecd1d7a662fbbc06a3a24cb6a17f85fb` |
| Stout Can (GN) | Original Guinness Foreign Extra Stout 330ml can | `guinness-fes-can-33cl.webp` | https://www.shoppersgatestores.com/products/guinness-stout ; image https://www.shoppersgatestores.com/storage/kjk-1.jpg | `a54b96de54d463dbb67eabbe50d8399f29161dc3cf2e21f9256282a232ed600e` |

**Photo rights:** These are genuine retailer product photographs but reuse rights **are not yet confirmed**. Source links are recorded, not a licence. This personal pilot does not grant rights for public redistribution or later commercial use; replace or get permission before commercial launch.

## Held back — not assigned, not shipped in public

- **Desperados 45cl bottle**: exact listing found but source blocked via 429/403/DNS; previous photo showed a different size. Do not substitute.
- **Amstel Can and Goldberg Can**: source did not download due 404/429.
- **Heineken Can**: real 33cl can downloaded, but lettering is cropped across the front in the source; seek a clearer original.
- **Medium Heineken**: photographed 45cl bottle but catalogue name does not specify exact 45cl size; no automatic assumption.
- **Guinness Smooth**: photographed 45cl glass bottle, but catalogue name does not specify size; hold pending variant confirmation.
- **Desperados Can**: downloaded 44cl original can but poor resolution/reflection below requested image quality; seek better.
- The legacy rejected Turbo King lion-only logo is not the approved Turbo King 60cl bottle file.

See `docs/photo-review-20261014/results.json` for the individual download attempts, SHA-256 values and source URLs. Unselected preview images are **not shipped into public/**. The one-off staging workflow and downloader are removed after final review.

## Release gate

This PR changes only two file types: three first-party packshot binaries and their source/test documentation, plus a NULL-only image-reference migration. No changes to price, stock, sales, payments, receipts, user interfaces or product identity. Test; check Codex and CI; merge; verify Vercel serves the exact merged commit **before applying the migration**; verify Supabase catalogue and linked shop image references. Until production data is changed, coverage remains **21/45 master and 20/22 shop**. Once live, expected **24/45 master and 21/22 shop** (verify actual totals). Because `Stout Can` and `Malta Can` are not configured in this shop, do not add them to stock automatically.
