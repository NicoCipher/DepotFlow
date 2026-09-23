import Link from "next/link";
import { getCustomer } from "@/lib/customers/data";
import { getRecentCustomerSales } from "@/lib/sales/data";
import { SalesList } from "@/components/sales-list";

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { customer, supabase } = await getCustomer(id);
  const [money, crates, bottles, deposits, sales] = await Promise.all([
    supabase
      .from("money_owed")
      .select("amount")
      .eq("customer_id", id)
      .maybeSingle(),
    supabase.from("crate_obligations").select("quantity").eq("customer_id", id),
    supabase
      .from("bottle_obligations")
      .select("quantity")
      .eq("customer_id", id),
    supabase
      .from("deposits")
      .select("amount")
      .eq("customer_id", id)
      .maybeSingle(),
    getRecentCustomerSales(supabase, id),
  ]);
  if ([money, crates, bottles, deposits].some((result) => result.error))
    throw new Error("Could not load customer totals.");
  const { saved } = await searchParams;
  const naira = (value: number) => `₦${value.toLocaleString("en-NG")}`;
  return (
    <>
      {(saved === "added" || saved === "updated") && (
        <p
          role="status"
          className="mb-5 border-l-4 border-emerald-800 pl-3 text-emerald-900"
        >
          Customer {saved === "added" ? "added" : "updated"}.
        </p>
      )}
      <h1 className="break-words">{customer.name}</h1>
      <a
        href={`tel:${customer.phone.replace(/[^+0-9]/g, "")}`}
        className="quiet-link mt-2 inline-block"
      >
        {customer.phone}
      </a>
      {customer.business_name && (
        <p className="mt-3 break-words font-medium">{customer.business_name}</p>
      )}
      {customer.address && (
        <p className="mt-2 whitespace-pre-line break-words text-stone-600">
          {customer.address}
        </p>
      )}
      <Link
        href={`/customers/${id}/edit`}
        className="secondary mt-6 self-start"
      >
        Edit details
      </Link>
      <dl className="mt-8 border-t border-stone-300">
        {[
          ["Money owed", naira(money.data?.amount ?? 0)],
          [
            "Crates owed",
            String(
              crates.data?.reduce((sum, row) => sum + row.quantity, 0) ?? 0,
            ),
          ],
          [
            "Bottles owed",
            String(
              bottles.data?.reduce((sum, row) => sum + row.quantity, 0) ?? 0,
            ),
          ],
          ["Deposit held", naira(deposits.data?.amount ?? 0)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex items-center justify-between gap-3 border-b border-stone-300 py-5"
          >
            <dt>{label}</dt>
            <dd className="text-xl font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      <section className="mt-10" aria-labelledby="customer-sales-heading">
        <h2
          id="customer-sales-heading"
          className="mb-4 text-2xl font-semibold"
        >
          Sales
        </h2>
        <SalesList
          sales={sales}
          showCustomer={false}
          showItemCount={false}
          emptyTitle="No sales for this customer"
          emptyMessage="Their saved sales will appear here."
        />
      </section>
    </>
  );
}
