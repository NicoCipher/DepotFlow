# Master catalogue product photographs — 45 products

**Scope is the full master catalogue**, including products not yet in stock or attached to any shop. A photo is part of catalogue identity, **not** evidence of availability or stock.

As of 2026-10-14 after the Big Smirnoff Ice 60cl pilot, 20/45 master drinks have first-party photo references and 25 are unassigned. This is a point-in-time snapshot; check current Supabase for live status.

## Already assigned (20)
33, Amstel, Big Ice, Big Stout, Budweiser, Castle Lite, Flying Fish, Goldberg, Gulder, Heineken, Legend, Life, Malta, Radler, Small Ice, Small Stout, Star, Tiger, Trophy, Trophy Stout.

## Not yet assigned (25)
4th Street; Amstel Can; Chamdor; Desperados; Desperados Can; Fayrouz; Fayrouz Can; Goldberg Black; Goldberg Can; Guinness Smooth; Heineken Can; Ice Black; Malta Can; Maltina; Maltina Can; Maltina PET 25cl; Maltina PET 33cl; Maltina PET 50cl; Medium Heineken; Medium Legend; Medium Stout; Origin; Small Turbo; Stout Can; Turbo.

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

## Batch 1: first two formerly unconfigured master products (14 Oct 2026)

Two real, manually inspected single-product photographs are ready in this branch; **do not claim live coverage has changed before deployment and DB linking**:
- **Maltina Can** — original 33cl Classic can packshot, source https://shoppersgatestores.com/products/maltina-33cl-classic-can ; image https://shoppersgatestores.com/storage/drinks/mmm.png
- **Maltina** — original 33cl Classic glass bottle, source https://shoppersgatestores.com/products/maltina-classic-33cl-bottle ; image https://shoppersgatestores.com/storage/drinks/maltina.jpg ; the master catalogue separately lists Maltina Can and three PET sizes, so the unqualified Maltina entry is treated as the glass-bottle line

Both are actual packshots on white, resized and metadata-stripped. Do **not** show stock availability for either — these are catalogue-only entries with no shop configuration. Unverified third-party photo rights remain a commercial-use concern.

**Rejected during this batch:** Fayrouz was a generic pharmacy icon, Chamdor a watermarked source, Maltina PET a 12-pack advertisement; images withheld. Initial other sources returned HTTP 429/403 or timed out. See `docs/master-photo-review-results.json` for individual attempts. Alternative sources and correctly specified flavours/sizes remain for later batches.
