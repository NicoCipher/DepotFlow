import { PausedSalesLink } from "@/components/paused-sales-link";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";

export default async function Home() {
  const supabase = await requireOwner();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <>
      <h1>Home</h1>
      {user && <PausedSalesLink ownerId={user.id} />}
      <section aria-label="Shop actions" className="mt-7">
        <Link
          href="/record-sale"
          className="mb-5 flex min-h-24 w-full items-center justify-between rounded-lg bg-emerald-900 px-5 text-left text-white"
        >
          <span className="text-xl font-semibold">Record Sale</span>
          <span aria-hidden="true">→</span>
        </Link>
        <Link
          href="/customers"
          className="flex min-h-20 items-center justify-between border-b border-stone-300 text-xl font-semibold"
        >
          Customers <span aria-hidden="true">→</span>
        </Link>
        <Link
          href="/sales"
          className="flex min-h-20 items-center justify-between border-b border-stone-300 text-xl font-semibold"
        >
          Sales <span aria-hidden="true">→</span>
        </Link>
        <Link
          href="/products"
          className="flex min-h-20 items-center justify-between border-b border-stone-300 text-xl font-semibold"
        >
          Products <span aria-hidden="true">→</span>
        </Link>
        <Link
          href="/stock"
          className="flex min-h-20 items-center justify-between border-b border-stone-300 text-xl font-semibold"
        >
          Stock <span aria-hidden="true">→</span>
        </Link>
      </section>
    </>
  );
}
