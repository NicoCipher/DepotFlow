export default function LoadingRecordSale() {
  return (
    <div className="mx-auto max-w-3xl space-y-5" role="status" aria-live="polite">
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <h1 className="text-xl font-bold text-emerald-950">Opening Record Sale</h1>
        <p className="mt-1 text-sm text-emerald-900">
          Getting the latest drinks and prices ready. Your paused sales stay on this device.
        </p>
      </div>
      <div className="space-y-3" aria-hidden="true">
        <div className="h-14 rounded-xl bg-stone-100" />
        <div className="grid grid-cols-2 gap-3">
          <div className="h-24 rounded-xl border border-stone-200 bg-white" />
          <div className="h-24 rounded-xl border border-stone-200 bg-white" />
        </div>
        <div className="h-32 rounded-xl border border-stone-200 bg-white" />
      </div>
    </div>
  );
}
