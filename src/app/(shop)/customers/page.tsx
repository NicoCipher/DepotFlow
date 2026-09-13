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
    .select("id,name,phone,business_name", { count: "exact" })
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
      <h1>Customers</h1>
      <Link className="primary mt-6 w-full" href="/customers/new">
        Add Customer
      </Link>
      <form action="/customers" className="my-7">
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
        <ul className="border-t border-stone-300">
          {data.map((customer) => (
            <li key={customer.id} className="border-b border-stone-300">
              <Link
                href={`/customers/${customer.id}`}
                className="block min-h-24 py-5"
              >
                <span className="block break-words text-lg font-semibold">
                  {customer.name}
                </span>
                {customer.business_name && (
                  <span className="block break-words text-sm text-stone-600">
                    {customer.business_name}
                  </span>
                )}
                <span className="mt-1 block text-stone-600">
                  {customer.phone}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
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
    </>
  );
}
