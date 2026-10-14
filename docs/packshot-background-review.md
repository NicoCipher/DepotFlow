# Real packshot background cleanup — manual review gate

User priority: remove distracting photography backgrounds without altering the real product or its label.

First audit of the 20 live bottle packshots found two clear photo-scene backgrounds:
- `amstel-malta-33cl.webp`: blue-grey texture and wall behind the amber bottle
- `legend-60cl.webp`: textured grey wall and floor behind the bottle

The one-shot worker saves candidate outputs to `docs/packshot-cleanup-preview/`, **not** the production `public/catalogue-photos/` image paths. It applies a foreground segmentation mask to original bottle RGB pixels, composites on pure white and exports metadata-free WebP. It does not synthesize bottles, labels or brand artwork.

**Required before replacing any production photo**:
1. Compare original and processed bottle and label at 100%: cap, neck, silhouette, transparent glass, text and edge integrity
2. Reject any shifted, removed or repainted product pixels, bad halos or clipped glass
3. Only then copy the approved output into the original existing filename, request Codex review and run all CI
4. Merge and confirm exact production Vercel commit; existing database references remain unchanged

Do not auto-publish everything that segmentation produces. All copyright/source warnings from `docs/catalogue-photo-sources.md` still apply.
