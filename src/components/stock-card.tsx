import type { Product } from "@/domain/models";
import { stockDescription } from "@/domain/stock";
import { ProductImage } from "./product-image";

export function StockCard({
  product,
  totalBottles,
}: {
  product: Pick<Product, "name" | "size" | "image_url" | "bottles_per_crate">;
  totalBottles: number | null;
}) {
  return (
    <article className="flex gap-4 rounded-lg border border-stone-200 bg-white p-4">
      <div className="h-24 w-20 shrink-0 overflow-hidden rounded">
        <ProductImage src={product.image_url} name={product.name} />
      </div>
      <div className="min-w-0">
        <h2 className="break-words text-lg font-semibold">{product.name}</h2>
        {product.size && (
          <p className="break-words text-stone-600">{product.size}</p>
        )}
        <p className="mt-1 text-sm text-stone-600">
          {product.bottles_per_crate} bottles per crate
        </p>
        <p className="mt-3 break-words font-semibold">
          {stockDescription(totalBottles, product.bottles_per_crate)}
        </p>
      </div>
    </article>
  );
}
