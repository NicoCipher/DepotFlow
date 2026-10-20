import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupCustomerOpeningForm } from "@/components/setup-customer-opening-form";
import { isUuid } from "@/domain/ids";
import { businessDateInLagos } from "@/domain/opening-business-date";
import { loadOwnerAssortment } from "@/lib/businesses/setup";
import { createClient } from "@/lib/supabase/server";

export default async function NewDepotCustomerOpeningPage({
  params,
}: {
  params: Promise<{ businessId: string; customerId: string }>;
}) {
  const { businessId, customerId } = await params;
  if (!isUuid(businessId) || !isUuid(customerId)) notFound();
  const owner = await loadOwnerAssortment(businessId);
  if (owner.state !== "ready") {
    return (
      <section className="mx-auto max-w-xl space-y-3">
        <Link href="/businesses" className="quiet-link">← Your depots</Link>
        <h1 className="text-xl font-bold">Customer opening is not enabled</h1>
        <p className="text-sm text-stone-600">
          Existing customer balances remain locked until multi-business
          onboarding receives release approval. No amounts were changed.
        </p>
      </section>
    );
  }
  const supabase = await createClient();
  const [customerResponse, existingResponse] = await Promise.all([
    supabase.from("customers").select("id,name,business_id")
      .eq("id", customerId).eq("business_id", businessId)
      .is("archived_at", null).maybeSingle(),
    supabase.from("customer_opening_balances")
      .select("id,amount,deposit_amount,business_id")
      .eq("customer_id", customerId).eq("business_id", businessId)
      .maybeSingle(),
  ]);
  if (customerResponse.error || !customerResponse.data ||
      customerResponse.data.business_id !== businessId) notFound();
  if (existingResponse.error ||
      existingResponse.data?.business_id &&
        existingResponse.data.business_id !== businessId) {
    throw new Error("Could not verify this customer's opening records.");
  }

  const crates = owner.snapshot.crateTypes.map((c) => ({
    type: c.id,
    name: `${c.name} · ${c.family} · ${c.pockets} pockets`,
  }));
  const bottleTypes = Array.from(new Set(
    owner.snapshot.configuredDrinks
      .filter((p) => p.active && p.returnable && p.bottleType)
      .map((p) => p.bottleType as string),
  )).sort().map((type) => ({ type, name: type }));

  return (
    <section className="mx-auto w-full max-w-2xl space-y-5 pb-8">
      <Link href={`/businesses/${businessId}/customers`} className="quiet-link">
        ← Customers
      </Link>
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
          {owner.name} · Setup / Customer history
        </p>
        <h1 className="text-2xl font-extrabold text-stone-950">
          {customerResponse.data.name}
        </h1>
        <p className="text-sm leading-6 text-stone-600">
          Check this customer&apos;s balances as they stood before your first
          DepotFlow sale. These are not new transactions.
        </p>
      </header>
      {existingResponse.data ? (
        <section className="space-y-3 rounded-2xl bg-stone-100 p-4">
          <h2 className="font-bold">Opening balances already recorded</h2>
          <p className="text-sm text-stone-600">
            An opening entry was saved for this customer. You cannot add
            another opening by changing the request number.
          </p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <p>Old debt owed to depot
              <strong className="block text-lg tabular-nums">
                ₦{existingResponse.data.amount.toLocaleString("en-NG")}
              </strong>
            </p>
            <p>Refundable deposit held
              <strong className="block text-lg tabular-nums">
                ₦{existingResponse.data.deposit_amount.toLocaleString("en-NG")}
              </strong>
            </p>
          </div>
        </section>
      ) : (
        <SetupCustomerOpeningForm
          businessId={businessId}
          customerId={customerId}
          requestId={randomUUID()}
          businessDate={businessDateInLagos()}
          crates={crates}
          bottleTypes={bottleTypes}
        />
      )}
      <Link href={`/businesses/${businessId}/customers`}
        className="secondary inline-flex min-h-11 items-center">
        Back to customers
      </Link>
    </section>
  );
}
