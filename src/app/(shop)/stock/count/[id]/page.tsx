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
      <h2 className="mt-5 break-words text-xl font-semibold">
        {product.name} {product.size}
      </h2>
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
