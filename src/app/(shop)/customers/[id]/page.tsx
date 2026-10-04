import { releaseHeldEmpties } from "./held-actions";
import { SuccessToast } from "@/components/success-toast";
import Link from "next/link";
import { getCustomer } from "@/lib/customers/data";
import { getRecentCustomerSales } from "@/lib/sales/data";
import { getRecentCustomerPayments } from "@/lib/payments/data";
import { SalesList } from "@/components/sales-list";
import { PaymentsList } from "@/components/payments-list";

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { customer, supabase } = await getCustomer(id);
  const [money, crates, bottles, deposits, sales, payments, held] = await Promise.all(
    [
      supabase
        .from("money_owed")
        .select("amount")
        .eq("customer_id", id)
        .maybeSingle(),
      supabase
        .from("crate_obligations")
        .select("crate_type_id,crate_type,quantity")
        .eq("customer_id", id)
        .gt("quantity", 0)
        .order("crate_type_id"),
      supabase
        .from("bottle_obligations")
        .select("bottle_type,quantity")
        .eq("customer_id", id)
        .gt("quantity", 0)
        .order("bottle_type"),
      supabase
        .from("deposits")
        .select("amount")
        .eq("customer_id", id)
        .maybeSingle(),
      getRecentCustomerSales(supabase, id),
      getRecentCustomerPayments(supabase, id),
      supabase.from("sale_empty_decisions").select("id,product_name,kind,returned_name,owed_name,quantity,sale_id").eq("customer_id", id).eq("decision", "hold").is("released_at", null).order("id"),
    ],
  );
  if ([money, crates, bottles, deposits, held].some((result) => result.error))
    throw new Error("Could not load customer totals.");

  const crateTypeIds = [
    ...new Set((crates.data ?? []).map((row) => row.crate_type_id).filter(Boolean)),
  ];
  const crateTypeNames = new Map<string, string>();
  if (crateTypeIds.length > 0) {
    const crateTypes = await supabase
      .from("crate_types")
      .select("id,name")
      .in("id", crateTypeIds);
    if (crateTypes.error) throw new Error("Could not load crate type names.");
    for (const crateType of crateTypes.data ?? []) {
      crateTypeNames.set(crateType.id, crateType.name);
    }
  }

  const { saved } = await searchParams;
  const naira = (value: number) => `₦${value.toLocaleString("en-NG")}`;
  return (
    <>
      {saved &&
        (
          {
            added: "Customer added.",
            updated: "Customer updated.",
            payment: "Payment recorded.",
            empties: "Empties returned. Balances updated.",
            archived: "Customer archived.",
            restored: "Customer restored.",
          } as Record<string, string>
        )[saved] && (
          <SuccessToast
            message={
              (
                {
                  added: "Customer added.",
                  updated: "Customer updated.",
                  payment: "Payment recorded.",
            empties: "Empties returned. Balances updated.",
                  archived: "Customer archived.",
                  restored: "Customer restored.",
                } as Record<string, string>
              )[saved]
            }
          />
        )}
      {customer.archived_at && (
        <p className="mb-3 inline-block self-start border border-stone-400 px-2 py-1 text-sm font-semibold uppercase tracking-wide text-stone-600">
          Archived
        </p>
      )}
      <Link className="quiet-link mb-3 self-start text-sm" href="/customers">
        ← Customers
      </Link>
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800">
        Customer account
      </p>
      <h1 className="break-words">{customer.name}</h1>
      {customer.business_name && (
        <p className="mt-2 break-words text-stone-600">
          {customer.business_name}
        </p>
      )}
      <section
        className="mt-5 rounded-2xl border border-stone-200 bg-white p-5"
        aria-label="Customer balance"
      >
        <p className="text-sm text-stone-600">Money owed</p>
        <p className="mt-1 break-words text-3xl font-semibold tracking-tight">
          {naira(money.data?.amount ?? 0)}
        </p>
        {(money.data?.amount ?? 0) > 0 ? (
          <Link href={`/customers/${id}/pay`} className="primary mt-4 w-full">
            Record Payment
          </Link>
        ) : (
          <p className="mt-3 text-sm font-medium text-emerald-800">
            All payments up to date
          </p>
        )}
      </section>
      <p className="mt-6 text-sm font-semibold text-stone-700">Empties still owed · all sales</p>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <dt className="text-sm text-stone-600">Crates owed</dt>
          <dd className="mt-1 text-2xl font-semibold">
            {crates.data?.reduce((sum, row) => sum + row.quantity, 0) ?? 0}
          </dd>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <dt className="text-sm text-stone-600">Bottles owed</dt>
          <dd className="mt-1 text-2xl font-semibold">
            {bottles.data?.reduce((sum, row) => sum + row.quantity, 0) ?? 0}
          </dd>
        </div>
      </dl>
      {(crates.data?.length ?? 0) > 0 && (
        <section className="mt-3 rounded-xl border border-stone-200 bg-white px-4 py-3" aria-labelledby="crates-owed-breakdown">
          <h2 id="crates-owed-breakdown" className="text-sm font-semibold">Crates owed by exact type</h2>
          <dl className="mt-2 divide-y divide-stone-100">
            {crates.data?.map((crate) => (
              <div key={crate.crate_type_id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <dt className="min-w-0 break-words text-stone-600">{crate.crate_type ?? crateTypeNames.get(crate.crate_type_id) ?? "Unknown crate type"}</dt>
                <dd className="shrink-0 font-semibold tabular-nums">{crate.quantity} {crate.quantity === 1 ? "crate" : "crates"}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs leading-5 text-stone-500">Exact crate types stay separate unless a swap rule says otherwise.</p>
        </section>
      )}
      {(bottles.data?.length ?? 0) > 0 && (
        <section className="mt-3 rounded-xl border border-stone-200 bg-white px-4 py-3" aria-labelledby="bottles-owed-breakdown">
          <h2 id="bottles-owed-breakdown" className="text-sm font-semibold">Bottles owed by type</h2>
          <dl className="mt-2 divide-y divide-stone-100">
            {bottles.data?.map((bottle) => (
              <div key={bottle.bottle_type} className="flex items-center justify-between gap-4 py-2 text-sm">
                <dt className="min-w-0 break-words text-stone-600">{bottle.bottle_type}</dt>
                <dd className="shrink-0 font-semibold tabular-nums">{bottle.quantity} {bottle.quantity === 1 ? "bottle" : "bottles"}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs leading-5 text-stone-500">Includes bottles still owed from earlier sales.</p>
        </section>
      )}
      <p className="mt-3 flex justify-between gap-3 px-1 text-sm text-stone-600">
        <span>Deposit held</span>
        <span>{naira(deposits.data?.amount ?? 0)}</span>
      </p>
      {((crates.data ?? []).some(row => row.quantity > 0) || Boolean(bottles.data?.length) || Boolean(held.data?.length)) && <Link className="secondary mt-5 w-full" href={`/customers/${id}/return-empties`}>Record empties brought back</Link>}
      <Link className="secondary mt-5 w-full" href={`/activity?customer=${id}`}>
        View all customer activity
      </Link>
      {Boolean(held.data?.length) && <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="text-xl font-semibold">Wrong empties held here</h2><p className="mt-2 text-sm">These belong to this customer. They are separate from your usable empty stock. The correct types are still owed.</p><ul className="mt-3 divide-y divide-amber-200">{held.data?.map(item => <li key={item.id} className="py-4"><p className="font-semibold">{item.quantity} {item.returned_name} {item.kind === "crate" ? "crates" : "bottles"}</p><p className="mt-1 text-sm">Held for {item.product_name} · {item.owed_name} still owed</p><Link className="quiet-link" href={`/sales/${item.sale_id}`}>View sale</Link><form action={releaseHeldEmpties} className="mt-2"><input type="hidden" name="id" value={item.id} /><input type="hidden" name="customer" value={id} /><button className="secondary w-full">Customer collected these empties</button></form></li>)}</ul></section>}
      <details className="group mt-5 border-y border-stone-200 py-2">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between font-medium">
          Contact details{" "}
          <span aria-hidden="true" className="group-open:rotate-45">
            +
          </span>
        </summary>
        <a
          href={`tel:${customer.phone.replace(/[^+0-9]/g, "")}`}
          className="quiet-link inline-block"
        >
          {customer.phone}
        </a>
        {customer.address && (
          <p className="mb-3 whitespace-pre-line break-words text-sm text-stone-600">
            {customer.address}
          </p>
        )}
      </details>
      <Link
        href={`/customers/${id}/edit`}
        className="quiet-link mt-2 self-start"
      >
        Manage customer
      </Link>
      <section className="mt-10" aria-labelledby="customer-sales-heading">
        <h2
          id="customer-sales-heading"
          className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500"
        >
          Recent sales
        </h2>
        <SalesList
          sales={sales.slice(0, 3)}
          showCustomer={false}
          showItemCount={false}
          emptyTitle="No sales for this customer"
          emptyMessage="Their saved sales will appear here."
        />
      </section>
      <section className="mt-10" aria-labelledby="customer-payments-heading">
        <h2
          id="customer-payments-heading"
          className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500"
        >
          Recent payments
        </h2>
        <PaymentsList payments={payments.slice(0, 3)} />
      </section>
    </>
  );
}
