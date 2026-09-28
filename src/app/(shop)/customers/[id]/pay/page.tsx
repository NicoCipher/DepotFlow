import { randomUUID } from "node:crypto";
import Link from "next/link";
import { formatNaira } from "@/domain/products";
import { getCustomer } from "@/lib/customers/data";
import { RecordPaymentForm } from "@/components/record-payment-form";

export default async function RecordPaymentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { customer, supabase } = await getCustomer(id);
  const money = await supabase
    .from("money_owed")
    .select("amount")
    .eq("customer_id", id)
    .maybeSingle();
  if (money.error) throw new Error("Could not load money owed.");
  const owed = money.data?.amount ?? 0;
  return (
    <>
      <Link
        className="quiet-link -mt-3 mb-3 self-start"
        href={`/customers/${id}`}
      >
        Back to {customer.name}
      </Link>
      <h1>Record Payment</h1>
      <section aria-label="Payment for customer" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Payment from</p>
        <p className="break-words text-xl font-bold text-emerald-950">{customer.name}</p>
        <p className="mt-2 text-emerald-950">Money owed: <strong className="text-lg">{formatNaira(owed)}</strong></p>
      </section>
      {owed > 0 ? (
        <>
          <p className="mt-5 text-stone-700">Enter what {customer.name} paid. The amount cannot be more than what they owe.</p>
          <RecordPaymentForm customerId={id} requestId={randomUUID()} />
        </>
      ) : (
        <p className="mt-6 text-stone-600">
          This customer does not owe any money.
        </p>
      )}
    </>
  );
}
