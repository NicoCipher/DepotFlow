import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getProduct } from "@/lib/products/data";
import { StockCountForm } from "@/components/stock-count-form";
export default async function CountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const product = await getProduct((await params).id);
  return (
    <>
      <h1>Set Current Stock</h1>
      <section aria-label="Drink being counted" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Counting</p>
        <h2 className="break-words text-xl font-bold text-emerald-950">{product.name} {product.size}</h2>
      </section>
      <p className="mt-2 text-stone-600">
        {product.bottles_per_crate} bottles per crate. Enter everything
        physically in the shop now.
      </p>
      <StockCountForm productId={product.id} requestId={randomUUID()} />
      <Link className="quiet-link mt-5" href="/stock/count">
        Choose another product
      </Link>
    </>
  );
}
