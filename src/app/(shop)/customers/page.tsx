import { PageIntro } from "@/components/page-intro";
import { CustomerIcon } from "@/components/customer-icon";
import { formatNaira } from "@/domain/products";
import { customerHasOutstanding } from "@/domain/customer-overview";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { customerSearchFilter } from "@/domain/customers";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const supabase = await requireOwner();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const page = Math.max(1, Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1));
  let request = supabase
    .from("customers")
    .select("id,name,phone,business_name,money_owed!money_owed_customer_id_fkey(amount)", { count: "exact" })
    .is("archived_at", null)
    .order("name")
    .order("id")
    .range((page - 1) * 30, page * 30 - 1);
  if (query) request = request.or(customerSearchFilter(query));
  const { data, error, count } = await request;
  if (error) throw new Error("Could not load customers.");

  // The owner-only RPC groups counts in PostgreSQL, avoiding PostgREST's
  // response-row limit when many individual held-return entries exist.
  const ids = (data ?? []).map((customer) => customer.id);
  const accountResult = ids.length
    ? await supabase.rpc("customer_account_snapshot", { p_customer_ids: ids })
    : { data: [], error: null };
  if (accountResult.error) throw new Error("Could not load customer balances.");
  const accountById = new Map(
    (accountResult.data ?? []).map((account) => [account.customer_id, account]),
  );
  const pageUrl = (value: number) =>
    "/customers?" + new URLSearchParams({ q: query, page: String(value) }).toString();

  return (
    <div className="pb-8">
      <PageIntro
        eyebrow="Customer accounts"
        title="Customers"
        description="Find someone, see what they owe and choose what to do next."
        action={
          <Link href="/customers/new" className="primary inline-flex w-full items-center justify-center gap-2 sm:w-auto">
            <CustomerIcon name="person" className="h-5 w-5" />
            Add customer
          </Link>
        }
      />

      <form action="/customers" role="search" className="mb-6 rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
        <label htmlFor="customer-search" className="font-semibold text-stone-900">Find a customer</label>
        <p className="mb-3 text-sm text-stone-600">Search by name or phone number.</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="customer-search" key={query} name="q" type="search" maxLength={120}
            placeholder="Enter a name or phone number"
            defaultValue={query}
            className="min-w-0 flex-1"
          />
          <button className="secondary min-h-11 sm:w-auto">Search</button>
        </div>
        {query && (
          <Link href="/customers" className="quiet-link mt-3 inline-flex">
            Clear search
          </Link>
        )}
      </form>

      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-stone-950">
            {query ? "Search results" : "Your customers"}
          </h2>
          <p className="text-sm text-stone-600">
            {count ?? 0} {query ? "matching" : "active"} {(count ?? 0) === 1 ? "customer" : "customers"}
          </p>
        </div>
        <span className="text-xs font-medium text-stone-500">Sorted by name</span>
      </div>
      {!data?.length ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-5 py-9">
          <h3 className="text-xl font-semibold">
            {query ? "No customer found" : "No customers yet"}
          </h3>
          <p className="mt-2 text-stone-600">
            {query ? "Try another spelling or phone number." : "Add a customer to track their money and empties in one place."}
          </p>
          {!query && <Link href="/customers/new" className="primary mt-5">Add your first customer</Link>}
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((customer) => {
            const money = customer.money_owed?.amount ?? 0;
            const account = accountById.get(customer.id);
            const owedCrates = account?.crates_owed ?? 0;
            const owedBottles = account?.bottles_owed ?? 0;
            const heldCount = account?.held_entries ?? 0;
            const needsAttention = customerHasOutstanding(money, owedCrates, owedBottles, heldCount);
            return (
              <li key={customer.id}>
                <Link
                  href={"/customers/" + customer.id}
                  className="group flex h-full min-h-48 flex-col rounded-2xl border border-stone-200 bg-white p-4 transition-colors hover:border-emerald-400 hover:bg-emerald-50/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800 sm:p-5"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <strong className="block break-words text-lg leading-6 text-stone-950">
                        {customer.name}
                      </strong>
                      {customer.business_name && <span className="mt-1 block break-words text-sm text-stone-600">{customer.business_name}</span>}
                      <span className="mt-1 block text-sm text-stone-500">{customer.phone}</span>
                    </span>
                    <span className={"shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold " +
                      (needsAttention ? "bg-amber-100 text-amber-950" : "bg-emerald-100 text-emerald-900")}>
                      {needsAttention ? "Needs attention" : "Nothing owed"}
                    </span>
                  </span>
                  <span className="mt-4 grid grid-cols-2 gap-3 border-t border-stone-100 pt-3">
                    <span className="col-span-2">
                      <span className="block text-xs font-medium text-stone-500">Money owed</span>
                      <span className={"mt-0.5 block break-words text-xl font-bold tabular-nums " +
                        (money > 0 ? "text-amber-950" : "text-stone-900")}>
                        {formatNaira(money)}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 text-sm text-stone-700">
                      <CustomerIcon name="crate" className="h-5 w-5 shrink-0 text-stone-500" />
                      <span><strong className="tabular-nums">{owedCrates}</strong> {owedCrates === 1 ? "crate" : "crates"} owed</span>
                    </span>
                    <span className="flex items-center gap-2 text-sm text-stone-700">
                      <CustomerIcon name="bottle" className="h-5 w-5 shrink-0 text-stone-500" />
                      <span><strong className="tabular-nums">{owedBottles}</strong> {owedBottles === 1 ? "bottle" : "bottles"} owed</span>
                    </span>
                  </span>
                  {heldCount > 0 && (
                    <span className="mt-3 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
                      {heldCount} {heldCount === 1 ? "wrong-empty return" : "wrong-empty returns"} held
                    </span>
                  )}
                  <span className="mt-auto flex items-center justify-between gap-2 pt-4 text-sm font-semibold text-emerald-900">
                    View account and activity
                    <CustomerIcon name="arrow" className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-1" />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <nav aria-label="Customer pages" className="mt-6 flex flex-wrap justify-between gap-3">
        {page > 1
          ? <Link href={pageUrl(page - 1)} className="secondary">← Previous</Link>
          : <span />}
        {(count ?? 0) > page * 30 && (
          <Link href={pageUrl(page + 1)} className="secondary">Next →</Link>
        )}
      </nav>
      <Link href="/customers/archived" className="quiet-link mt-6 inline-flex text-sm">
        View archived customers
      </Link>
    </div>
  );
}
