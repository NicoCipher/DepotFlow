"use client";

import { useState } from "react";
import { trustedProductImageUrl } from "@/domain/product-images";
import { drinkArtworkPath } from "@/domain/drink-art";

/** Prefer an actual owner-approved photo; otherwise show a first-party identifier. */
export function ProductImage({
  src,
  name,
}: {
  src: string | null;
  name: string;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null);

  const photo = src && trustedProductImageUrl(src) && failedPhoto !== src ? src : null;
  const artwork = drinkArtworkPath(name);
  if (!photo && failedArtwork === artwork) {
    return (
      <div className="grid h-full min-h-20 w-full place-items-center rounded-lg bg-stone-100 p-2 text-center text-xs font-semibold text-stone-700" role="img" aria-label={name}>
        {name}
      </div>
    );
  }
  return (
    // No arbitrary links: only Supabase's own Storage URLs or our bundled /drink-art files.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={photo ?? artwork}
      alt={photo ? name : `Illustrated identifier for ${name}`}
      width={240}
      height={300}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="h-full w-full object-contain"
      onError={() => {
        if (photo) setFailedPhoto(photo);
        else setFailedArtwork(artwork);
      }}
    />
  );
}
