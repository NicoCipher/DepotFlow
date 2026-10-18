import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupNewCustomerForm } from "@/components/setup-new-customer-form";
import { isUuid } from "@/domain/ids";
import { loadOwnerAssortment } from "@/lib/businesses/setup";
import { createClient } from "@/lib/supabase/server";

/** Tenant-isolated onboarding customers; never reuse the old shop's
 * customer list which is deliberately restricted to the legacy owner.
 */
export default async function NewDepotCustomersPage({
  params, searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ added?: string }>;
}) {
  const { businessId } = await params;
  if (!isUuid(businessId)) notFound();

  const owner = await loadOwnerAssortment(businessId);
  if (owner.state !== "ready") {
    return (
      <section className="mx-auto max-w-2xl space-y-3">
        <Link href="/businesses" className="quiet-link">← Your depots</Link>
        <h1 className="text-2xl font-bold">Customer setup is not available</h1>
        <p className="text-sm text-stone-600">
          Customer registration is locked until the verified multi-business
          release. No customers or balances were changed.
        </p>
      </section>
    );
  }

  const supabase = await createClient();
  const result = await supabase.from("customers")
    .select("id,name,phone,business_id")
    .eq("business_id", businessId)
    .is("archived_at", null)
    .order("name", { ascending: true })
    .limit(50);
  if (result.error || !result.data ||
      result.data.some((c) => c.business_id !== businessId)) {
    throw new Error("Could not verify the selected depot's customers.");
  }

  const query = await searchParams;
  return (
    <section className="mx-auto w-full max-w-2xl space-y-5 pb-8">
      <Link href={`/businesses/${businessId}/stock`} className="quiet-link">
        ← Starting stock
      </Link>
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
          {owner.name} · Setup
        </p>
        <h1 className="mt-1 text-2xl font-extrabold text-stone-950">
          Register your customers
        </h1>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          Enter the people or businesses you already sell to. Old money owed
          and returned-empty obligations are separate from customer identity.
        </p>
      </header>
      {query.added === "1" && (
        <p className="rounded-xl bg-stone-100 p-3 text-sm font-semibold" role="status">
          Customer saved in this depot. Add another customer or continue to opening balances.
        </p>
      )}
      <section className="rounded-2xl bg-stone-100 p-4">
        <h2 className="text-sm font-bold text-stone-950">
          Registered customers · {result.data.length}{result.data.length === 50 ? "+" : ""}
        </h2>
        {result.data.length > 0 ? (
          <ul className="mt-2 divide-y divide-stone-200">
            {result.data.map((customer) => (
              <li key={customer.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <strong className="min-w-0 break-words text-sm">{customer.name}</strong>
                <span className="text-xs tabular-nums text-stone-600">{customer.phone}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-stone-600">
            No customers registered yet. Add the first one below.
          </p>
        )}
        {result.data.length === 50 && (
          <p className="mt-2 text-xs text-stone-600">
            Showing the first 50 by name. Complete searchable customer
            management will be available in the operational release.
          </p>
        )}
      </section>
      <SetupNewCustomerForm businessId={businessId} customerId={randomUUID()} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Link href={`/businesses/${businessId}/stock`}
          className="secondary inline-flex min-h-12 items-center justify-center">
          Back to starting stock
        </Link>
        <Link href={`/businesses/${businessId}/opening`}
          className="secondary inline-flex min-h-12 items-center justify-center">
          Review opening balances →
        </Link>
      </div>
      <p className="text-xs leading-5 text-stone-600">
        The new customer record does not create a sale, receipt, deposit,
        debt or stock movement. Existing financial balances must be checked
        and confirmed separately.
      </p>
    </section>
  );
}
