import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getProduct } from "@/lib/products/data";
import { requireOwner } from "@/lib/auth/owner";
import { formatQuantity } from "@/domain/quantity";
import { StockCountForm } from "@/components/stock-count-form";

export default async function CountPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const product = await getProduct((await params).id);
  const db = await requireOwner();
  const { data: recorded, error } = await db
    .from("stock")
    .select("total_bottles")
    .eq("product_id", product.id)
    .maybeSingle();
  if (error) throw new Error("Could not load current stock.");

  return (
    <>
      <h1>Set Current Stock</h1>
      <section aria-label="Drink being counted" className="mt-5 border-b border-stone-200 pb-4">
        <p className="text-sm text-stone-500">Counting</p>
        <h2 className="break-words text-2xl font-semibold tracking-tight text-stone-950">
          {product.name} {product.size}
        </h2>
      </section>
      <p className="mt-2 text-stone-600">
        {product.bottles_per_crate} bottles per crate. Enter everything physically
        in the shop now. This sets the total; it does not add to existing stock.
      </p>
      <section aria-label="Recorded quantity before counting" className="mt-5 rounded-xl border border-stone-200 bg-stone-50 p-4">
        <p className="text-sm text-stone-600">Currently recorded</p>
        <p className="mt-1 text-xl font-semibold">
          {recorded ? formatQuantity(recorded.total_bottles, product.bottles_per_crate) : "Not counted yet"}
        </p>
        <p className="mt-1 text-xs text-stone-600">The latest amount is checked again before saving.</p>
      </section>
      <StockCountForm
        productId={product.id}
        requestId={randomUUID()}
        bottlesPerCrate={product.bottles_per_crate}
      />
      <Link className="quiet-link mt-5" href="/stock/count">
        Choose another product
      </Link>
    </>
  );
}
