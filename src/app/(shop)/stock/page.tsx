import { SuccessToast } from "@/components/success-toast";
import { PageIntro } from "@/components/page-intro";
import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { StockCard } from "@/components/stock-card";

export default async function StockPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; received?: string; counted?: string }>;
}) {
  const supabase = await requireOwner();
  const params = await searchParams;
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1),
  );
  const { data, error, count } = await supabase
    .from("products")
    .select("id,name,size,image_url,bottles_per_crate,stock(total_bottles)", {
      count: "exact",
    })
    .order("name")
    .order("id")
    .range((page - 1) * 30, page * 30 - 1);
  if (error) throw new Error("Could not load stock.");
  return (
    <>
      <PageIntro
        eyebrow="Drinks in the depot"
        title="Stock"
        description="See what is available to sell. Receive a delivery or correct a physical count."
      />
      {params.received === "1" && <SuccessToast message="Stock received." />}
      {params.counted === "1" && (
        <SuccessToast message="Current stock saved." />
      )}
      <div className="mb-7 grid grid-cols-2 gap-3">
        <Link
          className="rounded-xl bg-emerald-900 p-4 text-white"
          href="/stock/receive"
        >
          <span className="block font-semibold">
            Receive Stock <span aria-hidden="true">↓</span>
          </span>
          <span className="mt-1 block text-xs leading-5 text-emerald-100">
            Add a new delivery
          </span>
        </Link>
        <Link
          className="rounded-xl border border-stone-200 bg-white p-4"
          href="/stock/count"
        >
          <span className="block font-semibold">Count Stock</span>
          <span className="mt-1 block text-xs leading-5 text-stone-600">
            Set what is here now
          </span>
        </Link>
      </div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Available drinks</h2>
        <span className="text-sm text-stone-500">{count ?? 0} drinks</span>
      </div>
      {!data?.length ? (
        <div className="rounded-xl border border-dashed border-stone-300 p-6">
          <h2 className="font-semibold">
            {page > 1 ? "No more drinks" : "Add your first drink"}
          </h2>
          <p className="mt-2 text-sm text-stone-600">
            {page > 1
              ? "Return to the previous page."
              : "Add a drink, then count its stock to start selling."}
          </p>
          {page === 1 && (
            <Link className="primary mt-4" href="/products/new">
              Add product
            </Link>
          )}
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {data.map((product) => (
            <li key={product.id}>
              <StockCard
                product={product}
                totalBottles={product.stock?.total_bottles ?? null}
              />
            </li>
          ))}
        </ul>
      )}
      <nav aria-label="Stock pages" className="mt-4 flex justify-between">
        {page > 1 && (
          <Link className="quiet-link" href={`/stock?page=${page - 1}`}>
            ← Previous
          </Link>
        )}
        {(count ?? 0) > page * 30 && (
          <Link className="quiet-link ml-auto" href={`/stock?page=${page + 1}`}>
            Next →
          </Link>
        )}
      </nav>
      <div className="mt-6 divide-y divide-stone-200 border-t border-stone-200">
        <Link
          className="flex min-h-14 items-center justify-between gap-3 py-3 font-medium text-emerald-900"
          href="/empty-crates"
        >
          Empty crates in the depot <span aria-hidden="true">→</span>
        </Link>
        <Link
          className="flex min-h-14 items-center justify-between gap-3 py-3 font-medium text-emerald-900"
          href="/activity?type=stock"
        >
          View stock history <span aria-hidden="true">→</span>
        </Link>
      </div>
    </>
  );
}
