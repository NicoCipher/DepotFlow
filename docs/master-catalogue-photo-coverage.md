# Master catalogue product photographs — live 45 products, schema 46 identities

**Scope is the full master catalogue**, including products not yet in stock or attached to any shop. A photo is part of catalogue identity, **not** evidence of availability or stock.

As of 2026-10-14, **production Supabase has 45 master catalogue rows**: 20 with first-party image references and 25 without. This is the actual live denominator, unrelated to stock. **The migration-defined catalogue has 46 distinct identities**: the historical `20260929110631_business_product_cost_catalogue.sql` deliberately preserves both `Desperado` and `Desperados`. The singular **`Desperado` is not present in the current production catalogue**, so a fresh migration-based environment may have 46 (20 photographed, 26 missing); track that missing identity separately and reconcile without merging/deleting products by assumption. Do not call the live database 46 rows unless verified.

## Already assigned (20)
33, Amstel, Big Ice, Big Stout, Budweiser, Castle Lite, Flying Fish, Goldberg, Gulder, Heineken, Legend, Life, Malta, Radler, Small Ice, Small Stout, Star, Tiger, Trophy, Trophy Stout.

## Not assigned in the pre-release snapshot (25 live rows; 26 migration-defined identities)

Once this PR's migration is applied, **only `Maltina Can`** leaves this missing list (24 live missing; 25 fresh-schema missing). **`Maltina` stays unassigned** until its exact glass/PET packaging and volume are confirmed by the owner. Keep the pre-release list for traceability.
4th Street; Amstel Can; Chamdor; Desperado [migration-defined identity, absent from live catalogue]; Desperados; Desperados Can; Fayrouz; Fayrouz Can; Goldberg Black; Goldberg Can; Guinness Smooth; Heineken Can; Ice Black; Malta Can; Maltina; Maltina Can; Maltina PET 25cl; Maltina PET 33cl; Maltina PET 50cl; Medium Heineken; Medium Legend; Medium Stout; Origin; Small Turbo; Stout Can; Turbo.

## Count reconciliation (required before saying "complete")

| Scope | Total | Photos assigned | Missing |
|---|---:|---:|---:|
| Production Supabase snapshot (14 Oct 2026) | 45 | 20 | 25 |
| Fresh environment after every migration in this PR | 46 | 21 projected; verify after migrating | 25 projected |

**The projections include only the verified Maltina Can image assigned by this PR's migration.** The live snapshot above is intentionally pre-release; after the new migration, the expected production count is **21/45 with images and 24 missing**, provided no other images or catalogue identities changed. Verify the real post-deployment count instead of assuming a migration result. Any shop product configured before the deployment receives the photo only when its own `image_url` is still NULL; owner-selected images are preserved.

The **live coverage metric must come from a current Supabase count**, while the planning checklist must also include `Desperado` until the singular/plural identity decision is made. Only add an image when the exact product variant is confirmed. This PR does not change, insert, or remove either identity.

## Next candidates
Staging the eight exact-packaging retailer listings in [master-photo-candidates.json](./master-photo-candidates.json) for inspection before linking. Do not infer an unspecified flavour/size from the catalogue name. For ambiguous variants (e.g. Chamdor red/white; Fayrouz flavours), retain unassigned until the intended product is verified.

## Quality gate
- Real physical-product photograph, accurate brand, flavour, volume and glass/can/PET
- No stock-based filtering; stock quantity zero must not suppress the catalogue photo
- No label invention, visual compositing onto another bottle, or wrong-size substitution
- Plain white/neutral background with clear readable label and similar bottle prominence
- Strip original EXIF; keep optimized first-party WebP, source and legal-use caveat recorded
- Publish only after manual review, CI, Codex, Vercel exact deployment check and conditional DB update
- Underlying image rights from third-party retailers are not confirmed; personal pilot does not grant commercial reuse rights

## Batch 1: one verified master catalogue product (14 Oct 2026)

Only the exact **Maltina Can** identity is approved for database linking in this PR; **do not claim live coverage has changed before deployment and DB linking**:
- **Maltina Can** — original 33cl Classic aluminium can, source https://shoppersgatestores.com/products/maltina-33cl-classic-can ; original photo https://shoppersgatestores.com/storage/drinks/mmm.png. Clean white-background first-party WebP, manually reviewed and SHA-256 pinned.
- **Maltina (unqualified catalogue name) — HOLD.** Found a real 33cl Classic glass bottle photograph from https://shoppersgatestores.com/products/maltina-classic-33cl-bottle ; however the bare catalogue name alone does **not** confirm that the product's packaging is glass 33cl. The candidate has been moved to `docs/held-catalogue-images/maltina-classic-glass-33cl.webp` for later review, **not** deployed as a public asset and **not** assigned in the database. Do not infer from the existence of separate PET/can records.

Photo identity is independent of stock: no inventory rows are created for Maltina Can. Unverified third-party photo reproduction rights remain a concern for public or commercial use.

**Rejected during this batch:** Fayrouz was a generic pharmacy icon, Chamdor a watermarked source, Maltina PET a 12-pack advertisement; images withheld. Initial other sources returned HTTP 429/403 or timed out. See `docs/master-photo-review-results.json` for individual attempts. Alternative sources and correctly specified flavours/sizes remain for later batches.
