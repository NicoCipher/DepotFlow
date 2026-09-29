import Link from "next/link";
import { randomUUID } from "node:crypto";
import { getCustomer } from "@/lib/customers/data";
import { PageIntro } from "@/components/page-intro";
import { SuccessToast } from "@/components/success-toast";
import { OpeningBalancesForm } from "@/components/opening-balances-form";
import { formatNaira } from "@/domain/products";
import { formatBusinessDate } from "@/domain/sales";
import { crateLabel } from "@/domain/crate-types";

type StoredLine = { type: string; name: string; quantity: number };
export default async function OpeningBalancesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { customer, supabase } = await getCustomer(id);
  const { data: opening, error } = await supabase
    .from("customer_opening_balances")
    .select("id,amount,business_date,note,crates,bottles,created_at")
    .eq("customer_id", id)
    .maybeSingle();
  if (error) throw new Error("Could not load opening balances.");
  const { saved } = await searchParams;
  const header = (
    <>
      <Link
        className="quiet-link mb-3 self-start"
        href={`/customers/${id}/edit`}
      >
        ← Manage Customer
      </Link>
      <PageIntro
        eyebrow="Customer management"
        title="Opening Balances"
        description="Money and empties already owed before DepotFlow."
      />
      <p className="text-sm text-stone-500">Customer</p>
      <p className="mb-5 break-words text-2xl font-semibold">{customer.name}</p>
    </>
  );
  if (opening)
    return (
      <>
        {header}
        {saved === "1" && <SuccessToast message="Opening balances recorded." />}
        <p className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm font-medium text-emerald-900">
          Opening balances are saved and included in this customer’s totals.
        </p>
        <dl className="review-list">
          <div>
            <dt>Balance date</dt>
            <dd>{formatBusinessDate(opening.business_date)}</dd>
          </div>
          <div>
            <dt>Old money owed added</dt>
            <dd className="font-semibold">{formatNaira(opening.amount)}</dd>
          </div>
        </dl>
        {(
          [
            ["crates", opening.crates],
            ["bottles", opening.bottles],
          ] as const
        ).map(([kind, raw]) => {
          const lines = raw as StoredLine[];
          return lines.length > 0 ? (
            <section
              className="mt-5 rounded-xl border border-stone-200 bg-white p-4"
              key={kind}
            >
              <h2 className="font-semibold">Empty {kind} added</h2>
              <dl className="mt-2 divide-y divide-stone-100">
                {lines.map((line) => (
                  <div
                    className="flex justify-between gap-3 py-2"
                    key={line.type}
                  >
                    <dt className="break-words text-sm text-stone-600">
                      {line.name}
                    </dt>
                    <dd className="font-semibold">{line.quantity}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null;
        })}
        {opening.note && (
          <p className="mt-4 break-words text-sm text-stone-600">
            Note: {opening.note}
          </p>
        )}
        <p className="mt-4 text-xs leading-5 text-stone-500">
          This is the original opening record. Check the customer account for
          current balances.
        </p>
        <Link className="primary mt-6 w-full" href={`/customers/${id}`}>
          View Current Balances
        </Link>
      </>
    );
  if (customer.archived_at)
    return (
      <>
        {header}
        <p className="text-stone-600">
          Restore this customer before adding opening balances.
        </p>
      </>
    );
  async function crateChoices() {
    const rows: { id: string; name: string }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("crate_types")
        .select("*")
        .eq("is_legacy", false)
        .not("pocket_count", "is", null)
        .not("empty_family", "is", null)
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error("Could not load crate types.");
      rows.push(...data.map((c) => ({ id: c.id, name: crateLabel(c) })));
      if (data.length < 1000)
        return rows.sort((a, b) => a.name.localeCompare(b.name));
    }
  }
  async function bottleChoices() {
    const names = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("products")
        .select("id,bottle_type")
        .eq("bottles_returnable", true)
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error("Could not load bottle types.");
      data.forEach((p) => {
        if (p.bottle_type) names.add(p.bottle_type);
      });
      if (data.length < 1000) break;
    }
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("bottle_obligations")
        .select("customer_id,bottle_type")
        .order("customer_id")
        .order("bottle_type")
        .range(offset, offset + 999);
      if (error) throw new Error("Could not load existing bottle types.");
      data.forEach((b) => names.add(b.bottle_type));
      if (data.length < 1000) break;
    }
    return [...names].sort().map((name) => ({ id: name, name }));
  }
  const [crates, bottles, money, currentCrates, currentBottles] =
    await Promise.all([
      crateChoices(),
      bottleChoices(),
      supabase
        .from("money_owed")
        .select("amount")
        .eq("customer_id", id)
        .maybeSingle(),
      supabase
        .from("crate_obligations")
        .select("quantity")
        .eq("customer_id", id),
      supabase
        .from("bottle_obligations")
        .select("quantity")
        .eq("customer_id", id),
    ]);
  if (money.error || currentCrates.error || currentBottles.error)
    throw new Error("Could not load current balance.");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return (
    <>
      {header}
      <aside className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <p>
          Only enter debt from before you started using DepotFlow. Do not enter
          debt from sales already saved here.
        </p>
        <p className="mt-2 font-semibold">
          Already recorded: {formatNaira(money.data?.amount ?? 0)},{" "}
          {currentCrates.data?.reduce((sum, row) => sum + row.quantity, 0) ?? 0}{" "}
          crates and{" "}
          {currentBottles.data?.reduce((sum, row) => sum + row.quantity, 0) ??
            0}{" "}
          bottles.
        </p>
      </aside>
      <OpeningBalancesForm
        customerId={id}
        requestId={randomUUID()}
        today={today}
        crates={crates}
        bottles={bottles}
      />
    </>
  );
}
