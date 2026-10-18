import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupOpeningStockForm } from "@/components/setup-opening-stock-form";
import { isUuid } from "@/domain/ids";
import { loadOwnerAssortment } from "@/lib/businesses/setup";
import { createClient } from "@/lib/supabase/server";

type Line = { kind: "drink" | "crate" | "bottle"; resource: string };

export default async function NewDepotStockPage({
  params, searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ recorded?: string }>;
}) {
  const { businessId } = await params;
  if (!isUuid(businessId)) notFound();

  const owner = await loadOwnerAssortment(businessId);
  if (owner.state !== "ready") return (
    <section className="mx-auto max-w-2xl space-y-3">
      <Link href="/businesses" className="quiet-link">← Your depots</Link>
      <h1 className="text-2xl font-bold">Opening stock is not enabled</h1>
      <p className="text-sm text-stone-600">
        This depot remains in setup. No stock was added or changed.
      </p>
    </section>
  );

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "preview_business_opening_count_progress", { p_business_id: businessId },
  );
  if (error || !data) return (
    <section className="mx-auto max-w-2xl space-y-3">
      <Link href={`/businesses/${businessId}/drinks`} className="quiet-link">
        ← Drinks and crates
      </Link>
      <h1 className="text-2xl font-bold">Opening stock is unavailable</h1>
      <p className="text-sm text-stone-600">
        Starting stock remains disabled until all the independent
        inventory permissions have been reviewed. Nothing was changed.
      </p>
    </section>
  );

  // Exact per-resource private opening markers are returned only by the
  // gated, owner-verified database function. Reject a malformed/truncated
  // response rather than showing already counted items as new.
  if (typeof data !== "object" || Array.isArray(data) ||
      data.businessId !== businessId || data.canActivate !== false ||
      data.readOnly !== true || data.truncated !== false ||
      !Array.isArray(data.lines) ||
      !data.lines.every((entry) => entry &&
        typeof entry === "object" && !Array.isArray(entry) &&
        ["drink", "crate", "bottle"].includes(String(entry.kind)) &&
        typeof entry.resource === "string")) {
    throw new Error("Could not verify initial physical stock progress.");
  }

  const progress = data.lines as Line[];
  const query = await searchParams;
  return (
    <section className="mx-auto w-full max-w-2xl space-y-5 pb-8">
      <Link href={`/businesses/${businessId}/drinks`} className="quiet-link">
        ← Drinks and crates
      </Link>
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
          {owner.name} · Setup / Starting stock
        </p>
        <h1 className="text-2xl font-extrabold text-stone-950">
          Count your starting stock
        </h1>
        <p className="text-sm leading-6 text-stone-600">
          Count what you have physically at this depot today. This is not a
          purchase or a sale, and does not include empties customers owe you.
        </p>
      </header>
      {query.recorded === "1" && (
        <p role="status" className="rounded-xl bg-stone-100 p-3 text-sm font-semibold">
          Starting count recorded. Choose another uncounted item below.
        </p>
      )}
      <SetupOpeningStockForm
        businessId={businessId}
        requestId={randomUUID()}
        setup={owner.snapshot}
        recorded={progress}
      />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href={`/businesses/${businessId}/drinks`}
          className="secondary inline-flex min-h-11 items-center justify-center">
          Back to drinks
        </Link>
        <Link href={`/businesses/${businessId}/customers`}
          className="primary inline-flex min-h-11 items-center justify-center">
          Next: Register customers →
        </Link>
        <Link href={`/businesses/${businessId}/opening`}
          className="secondary inline-flex min-h-11 items-center justify-center">
          Review setup checklist
        </Link>
      </div>
    </section>
  );
}
