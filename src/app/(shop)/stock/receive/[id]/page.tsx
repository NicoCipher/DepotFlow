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
      <h1>Add Stock</h1>
      <h2 className="mt-5 break-words text-xl font-semibold">
        {product.name} {product.size}
      </h2>
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
