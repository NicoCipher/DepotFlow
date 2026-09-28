import Link from "next/link";
import { ProductImage } from "@/components/product-image";

export function StockProductChoice({
  product,
  action,
}: {
  product: { id: string; name: string; size: string | null; image_url: string | null; bottles_per_crate: number };
  action: "receive" | "count";
}) {
  return (
    <Link
      className="flex min-h-20 items-center gap-3 rounded-lg border border-stone-200 bg-white p-3"
      href={`/stock/${action}/${product.id}`}
    >
      <span className="size-14 shrink-0 overflow-hidden rounded">
        <ProductImage src={product.image_url} name={product.name} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-semibold">{product.name} {product.size}</span>
        <span className="block text-sm text-stone-600">{product.bottles_per_crate} bottles per crate</span>
      </span>
      <span aria-hidden="true" className="text-emerald-900">→</span>
    </Link>
  );
}
