"use client";
import { useState } from "react";
import { validImageUrl } from "@/domain/products";

export function ProductImage({
  src,
  name,
}: {
  src: string | null;
  name: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!src || !validImageUrl(src) || failedUrl === src) {
    return (
      <div
        className="grid h-full min-h-20 w-full place-items-center bg-stone-100 p-2 text-center text-xs text-stone-500"
        role="img"
        aria-label={`No image for ${name}`}
      >
        No image
      </div>
    );
  }
  // Load only in the owner's browser, without proxying arbitrary URLs through our server.
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
