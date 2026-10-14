# Real packshot background cleanup — accepted preview review

## Goal
All product photographs use a clean, plain white background with readable, unchanged real packaging and consistent 640 × 800 WebP framing.

## Reviewed on 14 October 2026
The **two real photographs** with visible photographic room backgrounds were successfully segmented and re-encoded, then visually compared with their actual published originals.

| Product | Original problem | Review | Final production filename |
|---|---|---|---|
| Amstel Malta 33cl glass bottle | Textured blue-grey photo wall | Clean white canvas; cap, label, amber glass and bottle edge retained | `public/catalogue-photos/amstel-malta-33cl.webp` |
| Legend 60cl Extra Stout glass bottle | Textured grey wall and floor | Clean white canvas; cap, label, bottle edge and printed markings retained | `public/catalogue-photos/legend-60cl.webp` |

Method: small foreground segmentation model `u2netp` computed masks from **real original product photographs**; the mask was applied to the original RGB pixels, and the background composited on white. Packaging/labels were **not generated or repainted**. WebP outputs have no source EXIF. A visual review of both 640×800 candidates confirmed their bottle/label remains recognizable.

The improved WebP files replace the original filenames, so existing database references continue working and **no database migration is needed**. No catalogue name, variant, selling price, stock, sales or receipt changed.

- Amstel Malta clean asset: 19,398 bytes; SHA-256 `05be9ccba2ee02284e4e29903b5d04bad506328f927f3410550cf6f7f102e19c`
- Legend clean asset: 21,898 bytes; SHA-256 `ad18c2c7d3e6dfca3d0cad79cf3e158c33d15415386d7922a3a975682207c942`

Source provenance and *unconfirmed third-party photo reproduction rights* are documented in `docs/catalogue-photo-sources.md`. A user's personal project does not itself give a licence for public redistribution. Replace with an authorised image or obtain permission before commercial release.

The temporary importer and preview assets were removed from this branch after visual review; only the two accepted WebPs are carried into the shipping PR.
