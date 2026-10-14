# Product photograph provenance

Only authentic photographs of physical products belong in DepotFlow. Do not substitute AI-generated packaging or alter product labels.

## Goldberg Premium Lager Beer — 60cl bottle

- Product identity: Goldberg Premium Lager Beer, green 600 ml/60 cl glass bottle, black/gold/red packaging.
- Actual photograph source: https://www.omnia-trading.com/product-page/goldberg-premium-lager
- Original image URL: https://static.wixstatic.com/media/523975_afcdee2b0a6844c48caadeea907cee8d~mv2.jpg/v1/fit/w_500%2Ch_500%2Cq_90/file.jpg
- Local asset path: `public/catalogue-photos/goldberg-60cl.webp` (21,554 bytes).
- Processing: cropped outer white margins; centre on 640 × 800 white background; Lanczos resize and mild sharpening; metadata removed. Actual product packaging and label preserved.
- Catalogue reference: `first-party/goldberg-60cl.webp`; shop image URL: `/catalogue-photos/goldberg-60cl.webp`.
- Current usage: restored on the owner's express instruction for the personal DepotFlow pilot. The file is hosted by DepotFlow, not hotlinked.
- **Reuse rights remain unconfirmed.** Omnia marks its website content all rights reserved. Personal/noncommercial use does not automatically authorize public redistribution. This source is **not rights-cleared**, and displaying it publicly carries copyright risk. Seek permission or substitute a verified licensed image before commercial distribution. Do not imply endorsement.

First-party packshot URLs remain restricted to DepotFlow's own domain. This record tracks provenance and does not grant reproduction rights.

## Curated 13-shop-drink real photo pilot (October 2026)

- All assets below were fetched as **real product photographs**, mechanically resized and metadata-stripped to 640 × 800 WebP, then **manually visually inspected** before proposing publication. They are served from DepotFlow's first-party `/catalogue-photos/` path, not remotely hotlinked.
- The source manifest records the exact individual source page, image URL, drink name, variant and notes: [shop-photo-source-manifest.json](./shop-photo-source-manifest.json).
- **The third-party photos are not certified licensed for redistribution.** This personal pilot's owner's request does not grant a legal licence. Replace or obtain permissions for commercial use, and take down a photograph if an owner objects. Do not claim brand endorsement.
- Only the 13 photographs shown below should be linked; failed or ambiguous variants have no DB reference. Original shop and master names sometimes differ; match them by the configured master catalogue name only.

| Shop drink | Filename | Source page |
|---|---|---|
| "33" Export | `33-export-60cl.webp` | [Retailer product listing](https://chomart.com/product/33-export-premium-larger-beer-60-cl-pBxUu) |
| Amstel Malta | `amstel-malta-33cl.webp` | [Retailer product listing](https://spiceeupp.co.uk/drinks/1444-amstel-malta-drink-330ml.html) |
| Big Guinness Stout | `guinness-stout-big-60cl.webp` | [Retailer product listing](https://africancaribbeanfoods.com/products/guinness-nigerian-foreign-extra-stout-600ml) |
| Budweiser | `budweiser-60cl.webp` | [Retailer product listing](https://www.supermart.ng/products/budweiser-lager-beer-bottle-60-cl) |
| Gulder | `gulder-60cl.webp` | [Retailer product listing](https://www.a2zdrinks.com/gulder-extra-matured-lager-600ml-case-of-12.html) |
| Legend | `legend-60cl.webp` | [Retailer product listing](https://mama-t.de/en/products/legend-extra-stout-beer) |
| Life | `life-60cl.webp` | [Retailer product listing](https://www.shoppersgatestores.com/products/life-60cl-bottle) |
| Malta Guinness | `malta-guinness-33cl.webp` | [Retailer product listing](https://www.kmiimpex.com/malta-guinness-non-alcoholic-malt-drink-330-ml.html) |
| Small Guinness Stout | `guinness-stout-small-33cl.webp` | [Retailer product listing](https://www.supermart.ng/products/guinness-foreign-extra-stout-bottle-33-cl) |
| Small Smirnoff Ice | `smirnoff-ice-small-33cl.webp` | [Retailer product listing](https://www.nepstores.com/product/smirnoff-ice-original----ml) |
| Star | `star-60cl.webp` | [Retailer product listing](https://afrobuy.co.uk/products/star-lager) |
| Star Radler Citrus | `star-radler-citrus-45cl.webp` | [Retailer product listing](https://www.shoppersgatestores.com/products/star-radler-citrus-45cl-bottle) |
| Trophy | `trophy-lager-60cl.webp` | [Retailer product listing](https://addide.com/products/trophy-lager-beer-60cl-bottle) |

**Hold:** Desperados source bottle visibly says **33cl**, not the shop’s 45cl variant (Codex P1), so we removed its file and DB mapping. Tiger source photo shows a bottle too tiny to recognize on mobile (Codex P2), so we removed its file and mapping pending a better crop. Trophy Stout photo import returned a generic missing-image icon, not a product photograph; the placeholder asset was deleted and the drink has no assigned image. Heineken Big, Big Smirnoff Ice, Turbo King, Castle Lite and Flying Fish await reliable exact product references. The 33 Export packshot may show an older design (2026 relaunch); the Small Smirnoff Ice packshot has a regional label; replace these with local-match photographs when confirmed.

See [shop-photo-import-results.json](./shop-photo-import-results.json) for HTTP failures and explicit visual rejection.

## Follow-up: five exact-size bottle photographs (October 2026)

Five more shop photos are visually confirmed and supplied through the same first-party bundling. Tiger is re-cropped from the earlier authentic 45cl photo; bottle, label and colors remain unchanged. The **original photographer's reproduction permission has not been verified**; see the [source candidate manifest](./remaining-shop-photo-candidates.json) and [fetch results](./remaining-shop-photo-fetch-results.json).

| Configured shop product | Verified asset | Retailer source |
|---|---|---|
| Heineken Big | `heineken-big-60cl.webp` | [Product listing](https://shoppersgatestores.com/products/heineken-60cl-bottle) |
| Castle Lite | `castle-lite-60cl.webp` | [Product listing](https://shoppersgatestores.com/products/castle-lite-beer-600ml) |
| Flying Fish | `flying-fish-45cl.webp` | [Product listing](https://shoppersgatestores.com/products/flying-fish-45cl-larger-beer) |
| Trophy Stout | `trophy-stout-60cl.webp` | [Product listing](https://shoppersgatestores.com/products/trophy-extra-stout-60cl) |
| Tiger | `tiger-45cl-closecrop.webp` | [Product listing](https://www.supermart.ng/products/tiger-lager-beer-45-cl) |

**Remaining on hold:** Big Smirnoff Ice (60cl), Desperados (45cl) and Turbo King (60cl); earlier direct fetches returned HTTP 429 or timed out. No source failed or variant mismatch is to be assigned merely to achieve 100% coverage.

## Big Smirnoff Ice 60cl (personal pilot)

- Verified product listing: https://martking.ng/product/smirnoff-ice-bottle-60-cl/
- Original 600×600 genuine bottle photograph: https://martking.ng/wp-content/uploads/2022/10/MartKing-Smirnoff-bottle.jpg
- Reprocessed into 640×800 `public/catalogue-photos/smirnoff-ice-big-60cl.webp`, EXIF removed and product label unmodified. Corresponding master catalogue name is **Big Ice**; linked shop drink is **Big Smirnoff Ice** (12 bottles per crate).
- The image shows original Smirnoff Ice packaging; retailer confirms 60cl. Exact current local packaging may differ, and a newer authorised photo should replace it when available.
- Photo reuse rights are unverified; owner-requested personal pilot only. This does not imply a licence or endorsement.
- Desperados Original 45cl image **not assigned**: 33cl image mismatch from earlier source and later exact-variant sources returned 429/403. Turbo King 60cl image **not assigned**: source yielded a logo rather than a bottle. Neither fallback should be published as a product photograph.
