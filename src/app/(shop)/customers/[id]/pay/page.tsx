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
      <p className="mt-2 break-words text-lg font-semibold">
        {customer.name}
      </p>
      <p className="mt-1 text-stone-600">Money owed: {formatNaira(owed)}</p>
      {owed > 0 ? (
        <RecordPaymentForm customerId={id} requestId={randomUUID()} />
      ) : (
        <p className="mt-6 text-stone-600">
          This customer does not owe any money.
        </p>
      )}
    </>
  );
}
