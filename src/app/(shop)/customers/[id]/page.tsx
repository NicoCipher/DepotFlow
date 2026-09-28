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
  const [money, crates, bottles, deposits, sales, payments] =
    await Promise.all([
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
      supabase
        .from("deposits")
        .select("amount")
        .eq("customer_id", id)
        .maybeSingle(),
      getRecentCustomerSales(supabase, id),
      getRecentCustomerPayments(supabase, id),
    ]);
  if ([money, crates, bottles, deposits].some((result) => result.error))
    throw new Error("Could not load customer totals.");
  const { saved } = await searchParams;
  const naira = (value: number) => `₦${value.toLocaleString("en-NG")}`;
  return (
    <>
      {(saved === "added" ||
        saved === "updated" ||
        saved === "payment" ||
        saved === "archived" ||
        saved === "restored") && (
        <p
          role="status"
          className="mb-5 border-l-4 border-emerald-800 pl-3 text-emerald-900"
        >
          {saved === "payment"
            ? "Payment recorded."
            : saved === "archived"
              ? "Customer archived."
              : saved === "restored"
                ? "Customer restored."
                : `Customer ${saved === "added" ? "added" : "updated"}.`}
        </p>
      )}
      {customer.archived_at && (
        <p className="mb-3 inline-block self-start border border-stone-400 px-2 py-1 text-sm font-semibold uppercase tracking-wide text-stone-600">
          Archived
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
      <dl className="mt-6 rounded-lg border border-stone-200 bg-white px-4">
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 py-4">
          <dt className="text-lg">Money owed</dt>
          <dd className="text-xl font-bold">
            {naira(money.data?.amount ?? 0)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 py-4">
          <dt>Crates owed</dt>
          <dd className="text-lg font-semibold">{crates.data?.reduce((sum, row) => sum + row.quantity, 0) ?? 0}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 py-4">
          <dt>Bottles owed</dt>
          <dd className="text-lg font-semibold">{bottles.data?.reduce((sum, row) => sum + row.quantity, 0) ?? 0}</dd>
        </div>
      </dl>
      <p className="mt-3 flex items-center justify-between text-stone-600">
        <span>Deposit held</span>
        <span>{naira(deposits.data?.amount ?? 0)}</span>
      </p>
      <Link href={`/customers/${id}/pay`} className="primary mt-6 w-full">
        Record Payment
      </Link>
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
      <section className="mt-10" aria-labelledby="customer-payments-heading">
        <h2
          id="customer-payments-heading"
          className="mb-4 text-sm font-semibold uppercase tracking-wide text-stone-500"
        >
          Payment History
        </h2>
        <PaymentsList payments={payments} />
      </section>
    </>
  );
}
