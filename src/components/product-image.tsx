"use client";
import { useState } from "react";
import { trustedProductImageUrl } from "@/domain/product-images";

/**
 * Show only an owner-approved real product photo.
 * Never silently replace a missing photograph with a pretend bottle.
 */
export function ProductImage({
  src,
  name,
}: {
  src: string | null;
  name: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!src || !trustedProductImageUrl(src) || failedUrl === src) {
    return (
      <div
        className="grid h-full min-h-20 w-full place-items-center bg-stone-100 p-2 text-center text-xs font-medium text-stone-700"
        role="img"
        aria-label={`No actual product photo yet for ${name}`}
      >
        <span>{name}</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      width={240}
      height={240}
      loading="lazy"
      referrerPolicy="no-referrer"
      className="h-full w-full object-contain"
      onError={() => setFailedUrl(src)}
    />
  );
}
