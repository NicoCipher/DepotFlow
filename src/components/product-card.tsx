import Link from "next/link";
import type { Product } from "@/domain/models";
import { formatNaira } from "@/domain/products";
import { ProductImage } from "./product-image";

export function ProductCard({
  product,
}: {
  product: Pick<
    Product,
    | "id"
    | "name"
    | "size"
    | "image_url"
    | "bottles_per_crate"
    | "full_crate_price"
    | "bottle_price"
  >;
}) {
  return (
    <Link
      href={`/products/${product.id}`}
      className="flex gap-4 rounded-lg border border-stone-200 bg-white p-4"
    >
      <div className="h-24 w-20 shrink-0 overflow-hidden rounded">
        <ProductImage src={product.image_url} name={product.name} />
      </div>
      <div className="min-w-0">
        <h2 className="break-words text-lg font-semibold">{product.name}</h2>
        {product.size && (
          <p className="break-words font-medium text-stone-600">
            {product.size}
          </p>
        )}
        <p className="mt-1 text-sm text-stone-600">
          {product.bottles_per_crate} bottles per crate
        </p>
        <p className="mt-2 font-semibold">
          {formatNaira(product.full_crate_price)}{" "}
          <span className="text-sm font-normal">/ crate</span>
        </p>
        {product.bottle_price !== null && (
          <p className="text-sm text-stone-600">
            {formatNaira(product.bottle_price)} / bottle
          </p>
        )}
      </div>
    </Link>
  );
}
