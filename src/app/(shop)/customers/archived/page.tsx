import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";

export default async function ArchivedCustomersPage() {
  const supabase = await requireOwner();
  const { data, error } = await supabase
    .from("customers")
    .select("id,name,phone")
    .not("archived_at", "is", null)
    .order("name")
    .order("id");
  if (error) throw new Error("Could not load archived customers.");
  return (
    <>
      <h1>Archived customers</h1>
      <Link className="quiet-link mt-2 self-start" href="/customers">
        Back to Customers
      </Link>
      {!data?.length ? (
        <div className="border-t border-stone-300 py-8">
          <h2 className="text-xl font-semibold">No archived customers</h2>
          <p className="mt-2 text-stone-600">
            Customers you archive will be listed here.
          </p>
        </div>
      ) : (
        <ul className="mt-7 border-t border-stone-300">
          {data.map((customer) => (
            <li key={customer.id} className="border-b border-stone-300">
              <Link
                href={`/customers/${customer.id}`}
                className="block min-h-24 py-5"
              >
                <span className="block break-words text-lg font-semibold">
                  {customer.name}
                </span>
                <span className="mt-1 block text-stone-600">
                  {customer.phone}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
