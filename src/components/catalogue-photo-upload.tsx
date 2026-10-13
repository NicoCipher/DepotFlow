"use client";

import { startTransition, useActionState, useEffect, useId, useState, type FormEvent } from "react";
import { uploadCataloguePhoto, type PhotoState } from "@/app/(shop)/products/catalogue/photo-actions";
import { uploadCustomProductPhoto } from "@/app/(shop)/products/[id]/photo-actions";
import { prepareOwnerPhoto } from "@/lib/client-product-photo";

const initial: PhotoState = { message: "", saved: false };

export function DrinkPhotoUpload({
  id,
  name,
  hasPhoto,
  kind = "catalogue",
  openByDefault = false,
}: {
  id: string;
  name: string;
  hasPhoto: boolean;
  kind?: "catalogue" | "product";
  openByDefault?: boolean;
}) {
  const submit = kind === "catalogue" ? uploadCataloguePhoto : uploadCustomProductPhoto;
  const [state, action, pending] = useActionState(submit.bind(null, id), initial);
  const fileId = useId();
  const [selected, setSelected] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const busy = pending || preparing;

  useEffect(() => {
    if (!selected) return;
    const next = URL.createObjectURL(selected);
    setPreview(next);
    return () => {
      URL.revokeObjectURL(next);
      setPreview(null);
    };
  }, [selected]);

  const choose = (file: File | undefined) => {
    setSelected(file ?? null);
    setError("");
  };

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!selected) {
      setError("Take a photo or choose one first.");
      return;
    }
    setPreparing(true);
    setError("");
    try {
      const safePhoto = await prepareOwnerPhoto(selected);
      const form = new FormData(event.currentTarget);
      form.set("photo", safePhoto);
      // Server repeats MIME/byte/ownership/rights validation before saving.
      startTransition(() => action(form));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not prepare this picture.");
    } finally {
      setPreparing(false);
    }
  }

  return (
    <details open={openByDefault ? true : undefined} className="mt-3 border-t border-stone-200 pt-3">
      <summary className="cursor-pointer text-sm font-semibold text-stone-800">
        {hasPhoto ? "Replace real photo" : "Add real photo"}
      </summary>
      <form onSubmit={onSubmit} className="mt-3 space-y-4">
        <div className="rounded-xl bg-stone-100 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">Photo for this exact drink</p>
          <p className="mt-1 break-words text-lg font-bold text-stone-900">{name}</p>
          <p className="mt-1 text-xs text-stone-600">Photograph the actual bottle or can. Make sure its label and size match this drink.</p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label htmlFor={`camera-${fileId}`} className="secondary flex min-h-12 cursor-pointer items-center justify-center text-center">
            Take a photo
          </label>
          <input
            id={`camera-${fileId}`} type="file" accept="image/*" capture="environment"
            className="sr-only" disabled={busy}
            onChange={(event) => choose(event.currentTarget.files?.[0])}
          />
          <label htmlFor={`gallery-${fileId}`} className="secondary flex min-h-12 cursor-pointer items-center justify-center text-center">
            Choose a picture
          </label>
          <input
            id={`gallery-${fileId}`} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="sr-only" disabled={busy}
            onChange={(event) => choose(event.currentTarget.files?.[0])}
          />
        </div>
        {preview && (
          <div className="flex items-center gap-3 rounded-xl border border-stone-200 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt={`Selected photograph for ${name}`} className="h-32 w-24 shrink-0 rounded-lg bg-white object-contain" />
            <p className="text-sm text-stone-700">
              Check the label, bottle size and photo before saving.
              <span className="mt-2 block font-semibold">{selected?.name}</span>
            </p>
          </div>
        )}
        <p className="text-xs text-stone-600">DepotFlow reduces large camera photos on your phone before uploading. The saved image is stored in DepotFlow’s own secure image storage.</p>
        <label className="flex items-start gap-3 text-sm text-stone-800">
          <input name="rights" value="yes" type="checkbox" required disabled={busy} className="mt-1 h-5 w-5 shrink-0" />
          I took this picture or have permission to use it.
        </label>
        <button type="submit" className="primary w-full" disabled={busy || !selected}>
          {preparing ? "Preparing photo…" : pending ? "Saving photo…" : `Save photo for ${name}`}
        </button>
        {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
        {state.message && (
          <p role={state.saved ? "status" : "alert"} className={state.saved ? "text-sm font-semibold text-emerald-900" : "text-sm text-red-800"}>
            {state.message}
          </p>
        )}
      </form>
    </details>
  );
}
