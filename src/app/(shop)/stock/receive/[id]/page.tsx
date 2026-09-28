import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getProduct } from "@/lib/products/data";
import { ReceiveStockForm } from "@/components/receive-stock-form";
export default async function ReceivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const product = await getProduct((await params).id);
  return (
    <>
      <h1>Receive Stock</h1>
      <section aria-label="Drink being received" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">Receiving</p>
        <h2 className="break-words text-xl font-bold text-emerald-950">{product.name} {product.size}</h2>
      </section>
      <p className="mt-2 text-stone-600">
        {product.bottles_per_crate} bottles per crate. Enter only what came in.
      </p>
      <ReceiveStockForm productId={product.id} requestId={randomUUID()} />
      <Link className="quiet-link mt-5" href="/stock/receive">
        Choose another product
      </Link>
    </>
  );
}
