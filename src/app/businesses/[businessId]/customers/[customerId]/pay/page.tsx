import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isUuid } from "@/domain/ids";
import { createClient } from "@/lib/supabase/server";
import { BusinessCustomerPaymentForm } from "./payment-form";

function lagosBusinessDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

export default async function BusinessCustomerPaymentPage({
  params,
}: {
  params: Promise<{ businessId: string; customerId: string }>;
}) {
  const { businessId, customerId } = await params;
  if (!isUuid(businessId) || !isUuid(customerId)) notFound();

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/sign-in?next=%2Fbusinesses");

  const { data: businesses, error: listError } =
    await supabase.rpc("list_my_businesses_for_setup");
  const business = businesses?.find((item) =>
    item.business_id === businessId &&
    item.member_kind === "owner" &&
    item.business_status === "active"
  );
  if (listError || !business) notFound();

  const { data: canRecordPayment, error: paymentGateError } = await supabase.rpc(
    "can_record_business_customer_payment",
    { p_business_id: businessId },
  );
  if (paymentGateError || canRecordPayment !== true) {
    return (
      <section className="mx-auto w-full max-w-xl space-y-4">
        <Link href={`/businesses/${businessId}/customers`} className="quiet-link">← Customers</Link>
        <h1 className="text-2xl font-extrabold">Debt payments are not enabled</h1>
        <p className="text-sm leading-6 text-stone-600">
          This depot can view customer accounts, but the separate debt-payment gate is still OFF. No payment can be recorded from this screen.
        </p>
      </section>
    );
  }

  const [customerResult, balanceResult] = await Promise.all([
    supabase.from("customers")
      .select("id,business_id,name,phone")
      .eq("id", customerId).eq("business_id", businessId)
      .is("archived_at", null).maybeSingle(),
    supabase.from("money_owed")
      .select("amount,business_id,customer_id")
      .eq("business_id", businessId).eq("customer_id", customerId)
      .maybeSingle(),
  ]);
  if (customerResult.error || !customerResult.data ||
      customerResult.data.business_id !== businessId) notFound();
  if (balanceResult.error ||
      (balanceResult.data && (balanceResult.data.business_id !== businessId ||
        balanceResult.data.customer_id !== customerId))) {
    throw new Error("Could not verify this customer's balance.");
  }

  const owed = balanceResult.data?.amount ?? 0;
  return (
    <section className="mx-auto w-full max-w-xl space-y-5 pb-8">
      <Link href={`/businesses/${businessId}/customers`} className="quiet-link">
        ← Customers
      </Link>
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
          {business.business_name} · Customer account
        </p>
        <h1 className="text-2xl font-extrabold">{customerResult.data.name}</h1>
        <p className="text-sm text-stone-600">{customerResult.data.phone}</p>
      </header>
      <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
        <p className="text-sm font-semibold text-stone-600">Outstanding debt</p>
        <p className="mt-1 text-3xl font-bold tabular-nums">
          ₦{owed.toLocaleString("en-NG")}
        </p>
      </section>
      {owed > 0 ? (
        <BusinessCustomerPaymentForm
          businessId={businessId}
          customerId={customerId}
          customerName={customerResult.data.name}
          requestId={randomUUID()}
          businessDate={lagosBusinessDate()}
          outstanding={owed}
        />
      ) : (
        <p className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
          This customer has no outstanding money debt. Empty-container obligations and refundable deposits are tracked separately.
        </p>
      )}
    </section>
  );
}
