"use client";

import { useActionState } from "react";
import { uploadCataloguePhoto, type PhotoState } from "@/app/(shop)/products/catalogue/photo-actions";

const initial: PhotoState = { message: "", saved: false };

export function CataloguePhotoUpload({ id, hasPhoto }: { id: string; hasPhoto: boolean }) {
  const [state, action, pending] = useActionState(uploadCataloguePhoto.bind(null, id), initial);
  return (
    <details className="mt-3 border-t border-stone-200 pt-3">
      <summary className="cursor-pointer font-semibold text-sm text-stone-700">
        {hasPhoto ? "Replace picture" : "Add picture"}
      </summary>
      <form action={action} className="mt-3 space-y-3">
        <label htmlFor={`photo-${id}`} className="block text-sm">
          Choose a clear picture of the exact bottle or can
        </label>
        <input
          id={`photo-${id}`} name="photo" type="file"
          accept="image/webp,image/png,image/jpeg" required
          disabled={pending} className="block w-full text-sm"
        />
        <p className="text-xs text-stone-600">JPG, PNG, or WebP. Maximum 1 MB. Prefer a plain background.</p>
        <button type="submit" className="secondary w-full" disabled={pending}>
          {pending ? "Saving picture…" : "Save picture"}
        </button>
        {state.message && (
          <p role={state.saved ? "status" : "alert"} className={state.saved ? "text-sm text-emerald-900" : "text-sm text-red-800"}>
            {state.message}
          </p>
        )}
      </form>
    </details>
  );
}
