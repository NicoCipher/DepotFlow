import { PageIntro } from "@/components/page-intro";
import { formatNaira } from "@/domain/products";
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
  const query =
    typeof params.q === "string" ? params.q.trim().slice(0, 120) : "";
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1),
  );
  let request = supabase
    .from("customers")
    .select("id,name,phone,business_name,money_owed(amount)", {
      count: "exact",
    })
    .is("archived_at", null)
    .order("name")
    .order("id")
    .range((page - 1) * 30, page * 30 - 1);
  if (query) request = request.or(customerSearchFilter(query));
  const { data, error, count } = await request;
  if (error) throw new Error("Could not load customers.");
  const pageUrl = (value: number) =>
    `/customers?${new URLSearchParams({ q: query, page: String(value) })}`;
  return (
    <>
      <PageIntro
        eyebrow="People you sell to"
        title="Customers"
        description="Open a customer to see what they owe, record a payment, or check their history."
        action={
          <Link className="primary" href="/customers/new">
            Add customer
          </Link>
        }
      />
      <form action="/customers" role="search" className="mb-5">
        <label htmlFor="search">Search by name or phone</label>
        <div className="flex gap-2">
          <input
            key={query}
            id="search"
            name="q"
            type="search"
            maxLength={120}
            defaultValue={query}
            className="min-w-0 flex-1"
          />
          <button className="secondary">Search</button>
        </div>
        {query && (
          <Link href="/customers" className="quiet-link inline-block">
            Clear search
          </Link>
        )}
      </form>
      {!data?.length ? (
        <div className="border-t border-stone-300 py-8">
          <h2 className="text-xl font-semibold">
            {query ? "No matching customers" : "No customers yet"}
          </h2>
          <p className="mt-2 text-stone-600">
            {query
              ? "Try a different name or phone number."
              : "Add your first customer to keep their details here."}
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {data.map((customer) => (
            <li
              key={customer.id}
              className="rounded-xl border border-stone-200 bg-white"
            >
              <Link
                href={`/customers/${customer.id}`}
                className="block min-h-24 p-4"
              >
                <span className="block break-words text-lg font-semibold">
                  {customer.name}
                </span>
                {customer.business_name && (
                  <span className="block break-words text-sm text-stone-600">
                    {customer.business_name}
                  </span>
                )}
                <span className="mt-1 block text-sm text-stone-500">
                  {customer.phone}
                </span>
                <span className="mt-3 flex items-center justify-between gap-3 border-t border-stone-100 pt-3 text-sm">
                  <span
                    className={
                      (customer.money_owed?.amount ?? 0) > 0
                        ? "font-semibold text-amber-900"
                        : "text-stone-500"
                    }
                  >
                    {(customer.money_owed?.amount ?? 0) > 0
                      ? `${formatNaira(customer.money_owed!.amount)} owed`
                      : "No money owed"}
                  </span>
                  <span className="font-semibold text-emerald-900">
                    Open <span aria-hidden="true">→</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-sm text-stone-500">
        {count ?? 0} {query ? "matching customers" : "active customers"}
      </p>
      <nav aria-label="Customer pages" className="mt-4 flex justify-between">
        {page > 1 && (
          <Link className="quiet-link" href={pageUrl(page - 1)}>
            Previous
          </Link>
        )}
        {(count ?? 0) > page * 30 && (
          <Link className="quiet-link ml-auto" href={pageUrl(page + 1)}>
            Next
          </Link>
        )}
      </nav>
      <Link
        className="quiet-link mt-5 self-start text-sm"
        href="/customers/archived"
      >
        Archived customers
      </Link>
    </>
  );
}
