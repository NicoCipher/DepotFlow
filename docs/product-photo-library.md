# DepotFlow drink photo library

Photos are uploaded once per master catalogue identity, to the existing Supabase Storage
bucket `product-images`, then reused by the shop's configured product.
`product_catalogue.image_path` stores the immutable object key, while
`products.image_url` caches the DepotFlow-owned public image URL for stock
and sales screens. Photo bytes never go into a Postgres field or a third-party
hotlink. The new upload flow does not fetch arbitrary URLs server-side.

## Uploading and verification

1. In **Drinks → Add drink**, find the matching brand, size and package.
2. Use **Add picture** on its catalogue card.
3. Upload a truthful photo of the exact variant, **JPG/PNG/WebP under 1 MB**.
4. Confirm that the picture appears in Drinks, Stock and Record Sale.
5. Replace an incorrect picture using the same card. Existing cached images
   use unique filenames, so replacements do not suffer stale CDN caching.

For initial population, prioritize stocked drinks, then complete every
unconfigured catalogue entry. Use original photos taken with permission,
licensed manufacturer product renders, or assets explicitly cleared for
the application. Manufacturer websites are useful to verify the right
bottle/can, but *availability online does not imply image reuse rights*.
Track rights and source in the asset approval process before uploading.
Do not use AI-generated lookalikes as ground truth for real packaging.

## Access and security

The bucket is public-read because product packaging is not private data.
Upload/delete policies must allow only verified shop owners; there is no
anonymous write permission. MIME allowlist and 1 MB bucket size limit are
enforced by Storage, and the server action checks both the reported MIME
and file signature. SVG is rejected. Object keys are generated and immutable;
the UI never accepts pasted remote image URLs. If the catalogue update fails,
the action cleans up the newly uploaded object. Replacements should be
periodically garbage-collected after verifying no DB row references them.

## Deployment order

Apply `20261012210000_catalogue_product_photos.sql` before deploying the app
code. Confirm existing `product-images` bucket settings (1 MB and JPG/PNG/WebP),
owner-only INSERT/DELETE Storage RLS policies, and owner update privileges
for `products.image_url`. Run tests and a live owner upload/check before
considering photo population complete.
