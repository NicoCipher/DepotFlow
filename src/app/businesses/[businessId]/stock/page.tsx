import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupOpeningStockForm } from "@/components/setup-opening-stock-form";
import { isUuid } from "@/domain/ids";
import { businessDateInLagos } from "@/domain/opening-business-date";
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

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) notFound();
  const { data: businesses, error: listError } =
    await supabase.rpc("list_my_businesses_for_setup");
  const business = businesses?.find((item) =>
    item.business_id === businessId &&
    item.member_kind === "owner" &&
    ["setup", "active"].includes(item.business_status)
  );
  if (listError || !business) notFound();

  if (business.business_status === "active") {
    const [{ data: canReceive, error: receiveGateError }, productsResult, emptiesResult] =
      await Promise.all([
        supabase.rpc("can_receive_business_stock", { p_business_id: businessId }),
        supabase.from("products")
          .select("id,business_id,name,size,bottles_per_crate,crate_type_id,stock(total_bottles)")
          .eq("business_id", businessId).eq("is_active", true)
          .order("name").order("id"),
        supabase.from("empty_crate_stock")
          .select("business_id,crate_type_id,quantity")
          .eq("business_id", businessId),
      ]);
    if (receiveGateError || productsResult.error || emptiesResult.error ||
        productsResult.data?.some((p) => p.business_id !== businessId) ||
        emptiesResult.data?.some((e) => e.business_id !== businessId)) {
      throw new Error("Could not verify this depot's current stock.");
    }
    const emptyByCrate = new Map(
      (emptiesResult.data ?? []).map((row) => [row.crate_type_id, row.quantity]),
    );
    return (
      <section className="mx-auto w-full max-w-2xl space-y-5 pb-8">
        <Link href="/businesses" className="quiet-link">← Your depots</Link>
        <header className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
            {business.business_name} · Inventory
          </p>
          <h1 className="text-2xl font-extrabold text-stone-950">Current stock</h1>
          <p className="text-sm leading-6 text-stone-600">
            These are the drinks and empty crates currently recorded for this depot.
          </p>
        </header>
        <div className="flex flex-wrap gap-2">
          <Link href={`/businesses/${businessId}/sales`} className="primary min-h-11 inline-flex items-center px-4">
            Record a sale
          </Link>
          <Link href={`/businesses/${businessId}/customers`} className="secondary min-h-11 inline-flex items-center px-4">
            Customers
          </Link>
        </div>
        {!canReceive && (
          <p className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
            Stock receiving is not enabled yet. Current stock is viewable, but no receiving transaction can be saved.
          </p>
        )}
        {productsResult.data?.length ? (
          <ul className="divide-y divide-stone-200 rounded-2xl border border-stone-200 bg-white">
            {productsResult.data.map((product) => {
              const stock = product.stock?.total_bottles ?? 0;
              const emptyCrates = emptyByCrate.get(product.crate_type_id) ?? 0;
              return (
                <li key={product.id} className="flex items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <strong className="block break-words">{product.name} {product.size}</strong>
                    <p className="mt-1 text-sm text-stone-600">
                      {stock.toLocaleString("en-NG")} bottles · {product.bottles_per_crate} per crate
                    </p>
                    <p className="text-xs text-stone-500">
                      {emptyCrates.toLocaleString("en-NG")} matching empty crates recorded
                    </p>
                  </div>
                  {canReceive ? (
                    <Link href={`/businesses/${businessId}/stock/receive/${product.id}`}
                      className="secondary min-h-11 shrink-0 text-xs">Receive</Link>
                  ) : (
                    <span className="text-xs text-stone-500">Locked</span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-xl border border-stone-200 p-4 text-sm text-stone-600">
            No active drinks are configured for this depot.
          </p>
        )}
      </section>
    );
  }

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
        businessDate={businessDateInLagos()}
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
