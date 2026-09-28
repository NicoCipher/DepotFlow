import type { Product } from "@/domain/models";
import Link from "next/link";
import { stockDescription } from "@/domain/stock";
import { ProductImage } from "./product-image";

export function StockCard({
  product,
  totalBottles,
}: {
  product: Pick<
    Product,
    "id" | "name" | "size" | "image_url" | "bottles_per_crate"
  >;
  totalBottles: number | null;
}) {
  const status =
    totalBottles === null
      ? "Needs count"
      : totalBottles === 0
        ? "Out of stock"
        : totalBottles <= product.bottles_per_crate
          ? "Low stock"
          : null;
  return (
    <article className="flex gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="h-20 w-16 shrink-0 overflow-hidden rounded">
        <ProductImage src={product.image_url} name={product.name} />
      </div>
      <div className="min-w-0 flex-1">
        {status && (
          <p className="mb-2 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
            {status}
          </p>
        )}
        <h2 className="break-words text-lg font-semibold">{product.name}</h2>
        {product.size && (
          <p className="break-words text-stone-600">{product.size}</p>
        )}

        <p className="mt-2 break-words text-lg font-semibold">
          {stockDescription(totalBottles, product.bottles_per_crate)}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-stone-100 pt-2 text-sm font-semibold">
          <Link className="quiet-link" href={`/stock/receive/${product.id}`}>
            Receive
          </Link>
          <Link className="quiet-link" href={`/stock/count/${product.id}`}>
            Set count
          </Link>
        </div>
      </div>
    </article>
  );
}
