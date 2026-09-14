import { crateLabel } from "@/domain/crate-types";
import Link from "next/link";
import { getProduct } from "@/lib/products/data";
import { formatNaira } from "@/domain/products";
import { ProductImage } from "@/components/product-image";
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const product = await getProduct((await params).id);
  const { saved } = await searchParams;
  const details: [string, string | null][] = [
    ["Bottles per crate", String(product.bottles_per_crate)],
    ["Full crate price", formatNaira(product.full_crate_price)],
    [
      "Half-crate price",
      product.half_crate_price === null
        ? null
        : formatNaira(product.half_crate_price),
    ],
    [
      "Quarter-crate price",
      product.quarter_crate_price === null
        ? null
        : formatNaira(product.quarter_crate_price),
    ],
    [
      "Bottle price",
      product.bottle_price === null ? null : formatNaira(product.bottle_price),
    ],
    ["Returnable bottles", product.bottles_returnable ? "Yes" : "No"],
    ["Physical crate", crateLabel(product.crate_types)],
    ["Empty bottle type", product.bottle_type],
  ];
  return (
    <>
      {(saved === "added" || saved === "updated") && (
        <p role="status" className="mb-5 border-l-4 border-emerald-800 pl-3">
          Product {saved === "added" ? "added" : "updated"}.
        </p>
      )}
      <h1 className="break-words">{product.name}</h1>
      {product.size && (
        <p className="mt-2 break-words text-xl text-stone-600">
          {product.size}
        </p>
      )}
      <div className="mt-5 h-48 w-48 self-center overflow-hidden rounded bg-white">
        <ProductImage src={product.image_url} name={product.name} />
      </div>
      <Link
        href={`/products/${product.id}/edit`}
        className="primary mt-6 w-full"
      >
        Edit product
      </Link>
      <dl className="mt-7 border-t border-stone-300">
        {details
          .filter(([, value]) => value !== null && value !== "")
          .map(([label, value]) => (
            <div
              key={label}
              className="flex justify-between gap-4 border-b border-stone-300 py-4"
            >
              <dt className="shrink-0">{label}</dt>
              <dd className="min-w-0 break-words text-right font-semibold">
                {value}
              </dd>
            </div>
          ))}
      </dl>
      <Link href="/products" className="quiet-link mt-5">
        Back to Products
      </Link>
    </>
  );
}
