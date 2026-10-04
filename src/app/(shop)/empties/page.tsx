import Link from "next/link";
import { PageIntro } from "@/components/page-intro";
import { requireOwner } from "@/lib/auth/owner";

type Customer = {
  id: string;
  name: string;
  business_name: string | null;
  archived_at: string | null;
};
type CrateOwed = {
  customer_id: string;
  crate_type_id: string;
  crate_type: string;
  quantity: number;
};
type BottleOwed = {
  customer_id: string;
  bottle_type: string;
  quantity: number;
};
type Held = {
  id: string;
  customer_id: string;
  product_name: string;
  kind: string;
  returned_name: string;
  owed_name: string;
  quantity: number;
};

export default async function EmptiesPage() {
  const db = await requireOwner();
  const [customersResult, cratesResult, bottlesResult, heldResult, crateTypesResult] =
    await Promise.all([
      db.from("customers")
        .select("id,name,business_name,archived_at")
        .order("name")
        .limit(1000),
      db.from("crate_obligations")
        .select("customer_id,crate_type_id,crate_type,quantity")
        .gt("quantity", 0)
        .order("customer_id")
        .limit(1000),
      db.from("bottle_obligations")
        .select("customer_id,bottle_type,quantity")
        .gt("quantity", 0)
        .order("customer_id")
        .limit(1000),
      db.from("sale_empty_decisions")
        .select("id,customer_id,product_name,kind,returned_name,owed_name,quantity")
        .eq("decision", "hold")
        .is("released_at", null)
        .order("customer_id")
        .limit(1000),
      db.from("crate_types").select("id,name").limit(1000),
    ]);

  if (
    customersResult.error ||
    cratesResult.error ||
    bottlesResult.error ||
    heldResult.error ||
    crateTypesResult.error
  ) {
    throw new Error("Could not load customer empties.");
  }

  const customers = customersResult.data as Customer[];
  const crates = cratesResult.data as CrateOwed[];
  const bottles = bottlesResult.data as BottleOwed[];
  const held = heldResult.data as Held[];
  const crateNames = new Map(crateTypesResult.data.map((row) => [row.id, row.name]));

  const actionIds = new Set([
    ...crates.map((row) => row.customer_id),
    ...bottles.map((row) => row.customer_id),
    ...held.map((row) => row.customer_id),
  ]);
  const actionCustomers = customers.filter((customer) => actionIds.has(customer.id));
  const totalCrates = crates.reduce((sum, row) => sum + row.quantity, 0);
  const totalBottles = bottles.reduce((sum, row) => sum + row.quantity, 0);
  const totalHeld = held.reduce((sum, row) => sum + row.quantity, 0);

  return (
    <>
      <PageIntro
        eyebrow="Customer returns"
        title="Empties"
        description="Only customers who currently owe crates or bottles, or have different empties being held."
      />

      <section
        aria-label="Empties needing attention"
        className="mb-7 grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-600">Customers</p>
          <p className="mt-1 text-2xl font-semibold">{actionCustomers.length}</p>
          <p className="mt-1 text-xs text-stone-500">need empties action</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-600">Crates owed</p>
          <p className="mt-1 text-2xl font-semibold">{totalCrates}</p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-600">Bottles owed</p>
          <p className="mt-1 text-2xl font-semibold">{totalBottles}</p>
        </div>
        <div className={`rounded-xl border p-4 ${totalHeld ? "border-amber-200 bg-amber-50" : "border-stone-200 bg-white"}`}>
          <p className="text-sm text-stone-600">Different empties held</p>
          <p className="mt-1 text-2xl font-semibold">{totalHeld}</p>
        </div>
      </section>

      {!actionCustomers.length ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-6">
          <h2 className="text-xl font-semibold">No customer empties need attention</h2>
          <p className="mt-2 text-stone-600">
            When a customer owes a crate or bottle, they will appear here automatically.
          </p>
          <Link href="/empty-crates" className="secondary mt-5">
            See empty crates in the depot
          </Link>
        </div>
      ) : (
        <section aria-labelledby="customer-empties-heading">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 id="customer-empties-heading" className="text-xl font-semibold">
              Customers to follow up
            </h2>
            <span className="text-sm text-stone-500">{actionCustomers.length}</span>
          </div>
          <ul className="grid gap-4 md:grid-cols-2">
            {actionCustomers.map((customer) => {
              const customerCrates = crates.filter((row) => row.customer_id === customer.id);
              const customerBottles = bottles.filter((row) => row.customer_id === customer.id);
              const customerHeld = held.filter((row) => row.customer_id === customer.id);
              return (
                <li key={customer.id} className="rounded-xl border border-stone-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="break-words text-lg font-semibold">{customer.name}</h3>
                      {customer.business_name && (
                        <p className="break-words text-sm text-stone-600">
                          {customer.business_name}
                        </p>
                      )}
                    </div>
                    {customer.archived_at && (
                      <span className="shrink-0 text-xs font-semibold uppercase tracking-wide text-stone-500">
                        Archived
                      </span>
                    )}
                  </div>

                  {(customerCrates.length > 0 || customerBottles.length > 0) && (
                    <div className="mt-4 border-t border-stone-100 pt-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                        Still owed
                      </p>
                      <ul className="mt-2 space-y-2">
                        {customerCrates.map((row) => (
                          <li key={row.crate_type_id} className="flex justify-between gap-4">
                            <span className="min-w-0 break-words">
                              {crateNames.get(row.crate_type_id) ?? row.crate_type}
                            </span>
                            <strong className="shrink-0 tabular-nums">
                              {row.quantity} {row.quantity === 1 ? "crate" : "crates"}
                            </strong>
                          </li>
                        ))}
                        {customerBottles.map((row) => (
                          <li key={row.bottle_type} className="flex justify-between gap-4">
                            <span className="min-w-0 break-words">{row.bottle_type}</span>
                            <strong className="shrink-0 tabular-nums">
                              {row.quantity} {row.quantity === 1 ? "bottle" : "bottles"}
                            </strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {customerHeld.length > 0 && (
                    <div className="mt-4 rounded-lg bg-amber-50 p-3">
                      <p className="font-semibold text-amber-950">
                        Different empties held here
                      </p>
                      {customerHeld.map((row) => (
                        <p key={row.id} className="mt-1 text-sm text-amber-950">
                          {row.quantity} {row.returned_name} {row.kind === "crate" ? "crates" : "bottles"} · {row.owed_name} still owed for {row.product_name}
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    <Link
                      href={`/customers/${customer.id}/return-empties`}
                      className="primary w-full"
                    >
                      Record return
                    </Link>
                    <Link
                      href={`/customers/${customer.id}`}
                      className="secondary w-full"
                    >
                      Customer account
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mt-7 divide-y divide-stone-200 border-t border-stone-200">
        <Link
          className="flex min-h-14 items-center justify-between gap-3 py-3 font-medium text-emerald-900"
          href="/empty-crates"
        >
          Empty crates physically in the depot <span aria-hidden="true">→</span>
        </Link>
        <Link
          className="flex min-h-14 items-center justify-between gap-3 py-3 text-sm text-stone-700"
          href="/empties-rules"
        >
          Empties rules and deposits <span aria-hidden="true">→</span>
        </Link>
      </div>
    </>
  );
}
