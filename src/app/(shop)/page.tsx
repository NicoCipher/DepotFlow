import Link from "next/link";
import { PausedSalesLink } from "@/components/paused-sales-link";
import { crateFitsProduct, crateNeedsSetup } from "@/domain/crate-types";
import { formatNaira } from "@/domain/products";
import { requireOwnerSession } from "@/lib/auth/owner";

function todayLagos() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default async function Home() {
  const { user, supabase } = await requireOwnerSession();
  const day = todayLagos();
  const dayLabel = new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", weekday: "long", day: "numeric", month: "long",
  }).format(new Date());

  async function loadCrateCustomers() {
    const ids: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase
        .from("crate_obligations")
        .select("customer_id")
        .gt("quantity", 0)
        .order("customer_id")
        .range(offset, offset + 999);
      if (result.error) throw new Error("Could not load customer empties.");
      ids.push(...result.data.map((row) => row.customer_id));
      if (result.data.length < 1000) return ids;
    }
  }

  async function loadBottleCustomers() {
    const ids: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase
        .from("bottle_obligations")
        .select("customer_id")
        .gt("quantity", 0)
        .order("customer_id")
        .range(offset, offset + 999);
      if (result.error) throw new Error("Could not load customer empties.");
      ids.push(...result.data.map((row) => row.customer_id));
      if (result.data.length < 1000) return ids;
    }
  }

  async function loadHeldEmpties() {
    const rows: { customer_id: string; kind: string; quantity: number }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase
        .from("sale_empty_decisions")
        .select("customer_id,kind,quantity")
        .eq("decision", "hold")
        .is("released_at", null)
        .order("customer_id")
        .order("id")
        .range(offset, offset + 999);
      if (result.error) throw new Error("Could not load held empties.");
      rows.push(...result.data);
      if (result.data.length < 1000) return rows;
    }
  }

  async function loadProductsForSetup() {
    const rows: {
      id: string;
      bottles_per_crate: number;
      crate_types: {
        is_legacy: boolean;
        pocket_count: number | null;
        empty_family: string | null;
      } | null;
    }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const result = await supabase
        .from("products")
        .select(
          "id,bottles_per_crate,crate_types(is_legacy,pocket_count,empty_family)",
        )
        .order("id")
        .range(offset, offset + 999);
      if (result.error) throw new Error("Could not load drink setup.");
      rows.push(...result.data);
      if (result.data.length < 1000) return rows;
    }
  }

  const [
    snapshotResult,
    crateCustomerIds,
    bottleCustomerIds,
    heldRows,
    productsForSetup,
  ] = await Promise.all([
    supabase.rpc("manager_snapshot", { p_day: day }),
    loadCrateCustomers(),
    loadBottleCustomers(),
    loadHeldEmpties(),
    loadProductsForSetup(),
  ]);

  if (snapshotResult.error) {
    throw new Error("Could not load today’s shop snapshot.");
  }

  const snapshot = snapshotResult.data as {
    sales_count: number;
    sales_value: number;
    received: number;
    outstanding: number;
    customers_owing: number;
    low_stock: number;
    missing_counts: number;
  };

  const emptiesCustomers = new Set([
    ...crateCustomerIds,
    ...bottleCustomerIds,
  ]).size;
  const heldCrates = heldRows
    .filter((row) => row.kind === "crate")
    .reduce((sum, row) => sum + row.quantity, 0);
  const heldBottles = heldRows
    .filter((row) => row.kind === "bottle")
    .reduce((sum, row) => sum + row.quantity, 0);
  const hasHeldEmpties = heldCrates > 0 || heldBottles > 0;
  const drinksNeedingSetup = productsForSetup.filter((product) => {
    const crate = product.crate_types;
    return (
      !crate ||
      crateNeedsSetup({
        ...crate,
        id: null,
        crate_type_id: null,
        name: null,
        variant: null,
      }) ||
      !crateFitsProduct(crate.pocket_count, product.bottles_per_crate)
    );
  }).length;
  const lowStockOnly = Math.max(0, snapshot.low_stock - snapshot.missing_counts);

  const attentionCount =
    (snapshot.customers_owing > 0 ? 1 : 0) +
    (emptiesCustomers > 0 ? 1 : 0) +
    (hasHeldEmpties ? 1 : 0) +
    (lowStockOnly > 0 ? 1 : 0) +
    (snapshot.missing_counts > 0 ? 1 : 0) +
    (drinksNeedingSetup > 0 ? 1 : 0);

  return (
    <div className="space-y-8 pb-4">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-800">{dayLabel}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Your shop today</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-stone-600 sm:text-base">
          Make a sale, check your money and see what needs attention.
        </p>
      </header>

      <section aria-label="Start working" className="space-y-3">
        <Link href="/record-sale" className="group flex min-h-36 items-center justify-between gap-4 rounded-3xl bg-emerald-900 px-5 py-6 text-white shadow-sm hover:bg-emerald-800 sm:px-7">
          <span className="min-w-0">
            <span className="block text-xs font-bold uppercase tracking-[0.14em] text-emerald-200">Start here</span>
            <span className="mt-1 block text-2xl font-bold tracking-tight sm:text-3xl">Record a sale</span>
            <span className="mt-2 block text-sm leading-5 text-emerald-100">Choose customer, add drinks and take payment</span>
          </span>
          <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-white/15 text-2xl">→</span>
        </Link>
        <PausedSalesLink ownerId={user.id} prominent />
      </section>

      <section aria-labelledby="money-heading">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="money-heading" className="text-lg font-bold">Today’s money</h2>
          <Link href="/sales" className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 py-2 text-sm font-semibold text-emerald-800 underline underline-offset-4 transition-colors hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800">View sales →</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="min-w-0 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
            <p className="text-sm font-semibold text-emerald-950">Money received</p>
            <p className="mt-2 break-words text-[clamp(1.65rem,5vw,2.5rem)] font-extrabold leading-tight tracking-tight text-emerald-950">
              {formatNaira(snapshot.received)}
            </p>
            <p className="mt-3 text-sm text-emerald-900">Payments from sales and old debts</p>
          </div>
          <div className="min-w-0 rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm font-semibold text-stone-800">Sales value</p>
            <p className="mt-2 break-words text-[clamp(1.65rem,5vw,2.5rem)] font-extrabold leading-tight tracking-tight text-stone-950">
              {formatNaira(snapshot.sales_value)}
            </p>
            <p className="mt-3 text-sm text-stone-600">
              {snapshot.sales_count} {snapshot.sales_count === 1 ? "sale" : "sales"} recorded · Includes unpaid sales
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="quick-actions-heading">
        <h2 id="quick-actions-heading" className="mb-3 text-lg font-bold">What do you want to do?</h2>
        <div className="grid grid-cols-2 gap-3">
          <Link href="/stock/receive" className="flex min-h-28 flex-col justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4 hover:border-emerald-400 hover:bg-emerald-50">
            <span className="text-base font-bold leading-snug text-stone-900">Receive stock</span>
            <span className="flex items-end justify-between gap-1 text-xs text-stone-600">
              Add new drinks <span aria-hidden="true" className="text-lg font-bold text-emerald-900">→</span>
            </span>
          </Link>
          <Link href="/customers" className="flex min-h-28 flex-col justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4 hover:border-emerald-400 hover:bg-emerald-50">
            <span className="text-base font-bold leading-snug text-stone-900">Record payment</span>
            <span className="flex items-end justify-between gap-1 text-xs text-stone-600">
              Choose customer <span aria-hidden="true" className="text-lg font-bold text-emerald-900">→</span>
            </span>
          </Link>
          <Link href="/stock/count" className="flex min-h-28 flex-col justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4 hover:border-emerald-400 hover:bg-emerald-50">
            <span className="text-base font-bold leading-snug text-stone-900">Count stock</span>
            <span className="flex items-end justify-between gap-1 text-xs text-stone-600">
              Check quantities <span aria-hidden="true" className="text-lg font-bold text-emerald-900">→</span>
            </span>
          </Link>
          <Link href="/empties" className="flex min-h-28 flex-col justify-between gap-3 rounded-2xl border border-stone-200 bg-white p-4 hover:border-emerald-400 hover:bg-emerald-50">
            <span className="text-base font-bold leading-snug text-stone-900">Check empties</span>
            <span className="flex items-end justify-between gap-1 text-xs text-stone-600">
              Crates and bottles <span aria-hidden="true" className="text-lg font-bold text-emerald-900">→</span>
            </span>
          </Link>
        </div>
      </section>

      <section aria-labelledby="attention-heading">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="attention-heading" className="text-lg font-semibold">
            Things to check
          </h2>
          {attentionCount > 0 && (
            <span className="text-sm text-stone-500">
              {attentionCount} {attentionCount === 1 ? "item" : "items"}
            </span>
          )}
        </div>

        {attentionCount === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="font-semibold">All caught up</p>
            <p className="mt-1 text-sm text-stone-600">
              Stock, customer balances and setup checks will appear here when needed.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-stone-200 overflow-hidden rounded-2xl border border-stone-200 bg-white">
            {snapshot.customers_owing > 0 && (
              <Link
                href="/customers"
                className="flex min-h-20 flex-wrap items-center justify-between gap-3 bg-white p-4 hover:bg-stone-50"
              >
                <span>
                  <strong className="block">Customer money owed</strong>
                  <small className="text-stone-600">
                    {snapshot.customers_owing} {snapshot.customers_owing === 1 ? "customer owes" : "customers owe"} money
                  </small>
                </span>
                <strong className="shrink-0 text-emerald-950">
                  {formatNaira(snapshot.outstanding)} →
                </strong>
              </Link>
            )}

            {emptiesCustomers > 0 && (
              <Link
                href="/empties"
                className="flex min-h-20 flex-wrap items-center justify-between gap-3 bg-white p-4 hover:bg-stone-50"
              >
                <span>
                  <strong className="block">Empties customers owe</strong>
                  <small className="text-stone-600">
                    Exact crates and bottles still outstanding
                  </small>
                </span>
                <strong className="shrink-0 text-emerald-950">
                  {emptiesCustomers} {emptiesCustomers === 1 ? "customer" : "customers"} →
                </strong>
              </Link>
            )}

            {hasHeldEmpties && (
              <Link
                href="/empties"
                className="flex min-h-20 flex-wrap items-center justify-between gap-3 bg-amber-50 p-4 hover:bg-amber-100"
              >
                <span>
                  <strong className="block text-amber-950">Different empties held</strong>
                  <small className="text-amber-900">
                    Kept for customers; correct types may still be owed
                  </small>
                </span>
                <strong className="shrink-0 text-right text-amber-950">
                  {heldCrates > 0 && (
                    <span className="block">
                      {heldCrates} {heldCrates === 1 ? "crate" : "crates"}
                    </span>
                  )}
                  {heldBottles > 0 && (
                    <span className="block">
                      {heldBottles} {heldBottles === 1 ? "bottle" : "bottles"} →
                    </span>
                  )}
                  {heldBottles === 0 && <span aria-hidden="true">→</span>}
                </strong>
              </Link>
            )}

            {lowStockOnly > 0 && (
              <Link
                href="/stock"
                className="flex min-h-20 flex-wrap items-center justify-between gap-3 bg-white p-4 hover:bg-stone-50"
              >
                <span>
                  <strong className="block">Low stock</strong>
                  <small className="text-stone-600">
                    One crate or less remaining
                  </small>
                </span>
                <strong className="shrink-0">
                  {lowStockOnly} {lowStockOnly === 1 ? "drink" : "drinks"} →
                </strong>
              </Link>
            )}

            {snapshot.missing_counts > 0 && (
              <Link
                href="/stock/count"
                className="flex min-h-20 flex-wrap items-center justify-between gap-3 bg-white p-4 hover:bg-stone-50"
              >
                <span>
                  <strong className="block">Stock not counted</strong>
                  <small className="text-stone-600">
                    Record what is physically in the shop
                  </small>
                </span>
                <strong className="shrink-0">
                  {snapshot.missing_counts} →
                </strong>
              </Link>
            )}

            {drinksNeedingSetup > 0 && (
              <Link
                href="/products"
                className="flex min-h-20 flex-wrap items-center justify-between gap-3 bg-white p-4 hover:bg-stone-50"
              >
                <span>
                  <strong className="block">Drinks need setup</strong>
                  <small className="text-stone-600">
                    Add missing crate details before selling
                  </small>
                </span>
                <strong className="shrink-0">
                  {drinksNeedingSetup} →
                </strong>
              </Link>
            )}
          </div>
        )}
      </section>

      <Link href="/activity" className="secondary w-full">
        View all store activity →
      </Link>
    </div>
  );
}
