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
      <section aria-label="Drink being received" className="mt-5 border-b border-stone-200 pb-4">
        <p className="text-sm text-stone-500">Receiving</p>
        <h2 className="break-words text-2xl font-semibold tracking-tight text-stone-950">{product.name} {product.size}</h2>
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
