import { PageIntro } from "@/components/page-intro";
import Link from "next/link";
import { SalesList } from "@/components/sales-list";
import { getSalesPage } from "@/lib/sales/data";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1),
  );
  const { sales, count } = await getSalesPage(page);
  return (
    <>
      <PageIntro
        eyebrow="Saved sales"
        title="Sales"
        description="Review exactly what was sold, the payment saved for that sale, and the empties recorded with it."
        action={
          <Link className="primary" href="/record-sale">
            Record Sale
          </Link>
        }
      />
      <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-semibold text-emerald-950">Looking for a receipt or customer payment?</p>
        <Link className="quiet-link mt-2 inline-flex min-h-11 items-center text-sm" href="/records?kind=sale">
          Find a sale by customer, date or receipt number in Records →
        </Link>
      </div>
      <SalesList sales={sales} showRecordSale />
      <nav aria-label="Sale pages" className="mt-4 flex justify-between">
        {page > 1 && (
          <Link className="quiet-link" href={`/sales?page=${page - 1}`}>
            Previous
          </Link>
        )}
        {count > page * 30 && (
          <Link className="quiet-link ml-auto" href={`/sales?page=${page + 1}`}>
            Next
          </Link>
        )}
      </nav>
    </>
  );
}
