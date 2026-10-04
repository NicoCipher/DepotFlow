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
    <div className="space-y-7">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
          Manager snapshot · {day}
        </p>
        <h1>Home</h1>
        <p className="mt-1 text-stone-600">
          Today’s sales, cash and what needs attention.
        </p>
      </header>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Link
          href="/record-sale"
          className="flex min-h-20 items-center justify-between rounded-2xl bg-emerald-900 px-5 text-xl font-semibold text-white shadow-sm"
        >
          Record Sale <span aria-hidden="true">→</span>
        </Link>
        <PausedSalesLink ownerId={user.id} prominent />
      </div>

      <section aria-labelledby="today-heading">
        <h2 id="today-heading" className="mb-3 text-lg font-semibold">
          Today
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-sm text-stone-600">Sales value</p>
            <p className="mt-1 text-2xl font-bold">
              {formatNaira(snapshot.sales_value)}
            </p>
            <p className="mt-1 text-xs text-stone-500">
              {snapshot.sales_count} {snapshot.sales_count === 1 ? "sale" : "sales"} · includes credit
            </p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm text-emerald-900">Money received</p>
            <p className="mt-1 text-2xl font-bold text-emerald-950">
              {formatNaira(snapshot.received)}
            </p>
            <p className="mt-1 text-xs text-emerald-800">
              Sale payments + collections
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="attention-heading">
        <div className="mb-3 flex items-end justify-between gap-3">
          <h2 id="attention-heading" className="text-lg font-semibold">
            Needs attention
          </h2>
          {attentionCount > 0 && (
            <span className="text-sm text-stone-500">
              {attentionCount} {attentionCount === 1 ? "area" : "areas"}
            </span>
          )}
        </div>

        {attentionCount === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="font-semibold">Nothing needs attention right now</p>
            <p className="mt-1 text-sm text-stone-600">
              New debts, missing empties, low stock and setup issues will appear here.
            </p>
          </div>
        ) : (
          <div className="grid overflow-hidden rounded-2xl border border-stone-200 bg-stone-200 md:grid-cols-2">
            {snapshot.customers_owing > 0 && (
              <Link
                href="/customers"
                className="flex min-h-20 items-center justify-between gap-3 bg-white p-4"
              >
                <span>
                  <strong className="block">Outstanding balances</strong>
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
                className="flex min-h-20 items-center justify-between gap-3 bg-white p-4"
              >
                <span>
                  <strong className="block">Customer empties owed</strong>
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
                className="flex min-h-20 items-center justify-between gap-3 bg-amber-50 p-4"
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
                className="flex min-h-20 items-center justify-between gap-3 bg-white p-4"
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
                className="flex min-h-20 items-center justify-between gap-3 bg-white p-4"
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
                className="flex min-h-20 items-center justify-between gap-3 bg-white p-4"
              >
                <span>
                  <strong className="block">Drinks need setup</strong>
                  <small className="text-stone-600">
                    Finish crate details before selling
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
