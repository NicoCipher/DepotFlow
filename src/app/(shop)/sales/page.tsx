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
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1>Sales</h1>
        {sales.length > 0 && (
          <Link className="primary" href="/record-sale">
            Record Sale
          </Link>
        )}
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
