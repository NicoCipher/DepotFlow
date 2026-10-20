import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupNewCustomerForm } from "@/components/setup-new-customer-form";
import { isUuid } from "@/domain/ids";
import { customerSearchFilter } from "@/domain/customers";
import { loadOwnerAssortment } from "@/lib/businesses/setup";
import { createClient } from "@/lib/supabase/server";

/** Tenant-isolated onboarding customers; never reuse the old shop's
 * customer list which is deliberately restricted to the legacy owner.
 */
export default async function NewDepotCustomersPage({
  params, searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ added?: string; customer?: string; q?: string; page?: string }>;
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

  const query = await searchParams;
  const search = (query.q ?? "").trim().replace(/\s+/g, " ").slice(0, 120);
  const rawPage = Number(query.page ?? "1");
  const page = Number.isSafeInteger(rawPage) && rawPage > 0
    ? Math.min(rawPage, 10000) : 1;
  const pageSize = 50;
  const offset = (page - 1) * pageSize;
  const customerListUrl = (nextPage: number) => {
    const searchParams = new URLSearchParams();
    if (search) searchParams.set("q", search);
    if (nextPage > 1) searchParams.set("page", String(nextPage));
    const suffix = searchParams.toString();
    return `/businesses/${businessId}/customers${suffix ? `?${suffix}` : ""}`;
  };

  const supabase = await createClient();
  let request = supabase.from("customers")
    .select("id,name,phone,business_id", { count: "exact" })
    .eq("business_id", businessId)
    .is("archived_at", null);
  if (search) request = request.or(customerSearchFilter(search));
  const result = await request
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + pageSize - 1);
  if (result.error || !result.data || result.count === null ||
      result.data.some((c) => c.business_id !== businessId)) {
    throw new Error("Could not verify the selected depot's customers.");
  }
  // The newly added customer must remain reachable even when the first
  // alphabetic page does not contain them.
  const addedId = query.added === "1" && typeof query.customer === "string" && isUuid(query.customer)
    ? query.customer : null;
  const created = addedId
    ? await supabase.from("customers").select("id,name,business_id")
        .eq("business_id", businessId).eq("id", addedId)
        .is("archived_at", null).maybeSingle()
    : null;
  if (created?.error || (created?.data && created.data.business_id !== businessId)) {
    throw new Error("Could not verify the recently saved customer.");
  }
  const total = result.count;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
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
        <div className="rounded-xl bg-stone-100 p-3 text-sm font-semibold" role="status">
          <p>Customer saved in this depot. Record previous debts, refundable deposits and unreturned empties separately.</p>
          {created?.data && (
            <Link className="quiet-link mt-2 inline-flex min-h-11 items-center"
              href={`/businesses/${businessId}/customers/${created.data.id}/opening`}>
              Old balances for {created.data.name} →
            </Link>
          )}
        </div>
      )}
      <section className="rounded-2xl bg-stone-100 p-4">
        <h2 className="text-sm font-bold text-stone-950">
          Registered customers · {total}
        </h2>
        <form className="mt-3 flex flex-wrap gap-2" action={`/businesses/${businessId}/customers`} method="get">
          <label className="sr-only" htmlFor="setup-customer-search">Find a customer</label>
          <input className="min-w-0 flex-1" id="setup-customer-search"
            name="q" type="search" maxLength={120} defaultValue={search}
            placeholder="Search name or phone" />
          <button className="secondary min-h-11" type="submit">Search</button>
          {search && <Link className="quiet-link self-center" href={customerListUrl(1).split("?")[0]}>Clear</Link>}
        </form>
        {result.data.length > 0 ? (
          <ul className="mt-2 divide-y divide-stone-200">
            {result.data.map((customer) => (
              <li key={customer.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <strong className="block break-words text-sm">{customer.name}</strong>
                  <span className="text-xs tabular-nums text-stone-600">{customer.phone}</span>
                </span>
                <Link href={`/businesses/${businessId}/customers/${customer.id}/opening`}
                  className="secondary shrink-0 text-xs">
                  Old balances
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-stone-600">
            {search ? "No customers match that search." :
              page > 1 ? "No customers on this page. Go to a previous page." :
              "No customers registered yet. Add the first one below."}
          </p>
        )}
        <nav className="mt-3 flex items-center justify-between gap-2 border-t border-stone-200 pt-3"
          aria-label="Customer pages">
          {page > 1
            ? <Link className="secondary min-h-11" href={customerListUrl(page - 1)}>← Previous</Link>
            : <span />}
          <span className="text-xs tabular-nums text-stone-600">
            Page {page} of {totalPages}
          </span>
          {page < totalPages &&
            <Link className="secondary min-h-11" href={customerListUrl(page + 1)}>Next →</Link>}
        </nav>
      </section>
      <SetupNewCustomerForm businessId={businessId} requestId={randomUUID()} />
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
