import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getProduct } from "@/lib/products/data";
import { requireOwner } from "@/lib/auth/owner";
import { formatQuantity } from "@/domain/quantity";
import { ReceiveStockForm } from "@/components/receive-stock-form";

export default async function ReceivePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const product = await getProduct((await params).id);
  const db = await requireOwner();
  const [stockResult, emptiesResult] = await Promise.all([
    db.from("stock").select("total_bottles").eq("product_id", product.id).maybeSingle(),
    product.crate_type_id
      ? db.from("empty_crate_stock").select("quantity").eq("crate_type_id", product.crate_type_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (stockResult.error || emptiesResult.error)
    throw new Error("Could not load current stock and empty crates.");

  const canReceive = Boolean(product.crate_type_id && product.crate_types);
  const availableEmpties = emptiesResult.data?.quantity ?? 0;

  return (
    <>
      <h1>Receive Stock</h1>
      <section aria-label="Drink being received" className="mt-5 border-b border-stone-200 pb-4">
        <p className="text-sm text-stone-500">Receiving</p>
        <h2 className="break-words text-2xl font-semibold tracking-tight text-stone-950">
          {product.name} {product.size}
        </h2>
      </section>
      <p className="mt-2 text-stone-600">
        {product.bottles_per_crate} bottles per crate. Enter only whole crates
        coming into the depot. Matching empty crates are used.
      </p>
      <section aria-label="Stock available before receiving" className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-600">Drinks recorded</p>
          <p className="mt-1 font-semibold">
            {stockResult.data
              ? formatQuantity(stockResult.data.total_bottles, product.bottles_per_crate)
              : "Not counted yet"}
          </p>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-600">Matching empty crates</p>
          <p className="mt-1 text-xl font-semibold">{availableEmpties}</p>
          <p className="mt-1 break-words text-xs text-stone-600">{product.crate_types?.name ?? "Needs crate setup"}</p>
        </div>
      </section>
      {!canReceive ? (
        <div role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="font-semibold text-amber-950">Finish crate setup first</p>
          <p className="mt-1 text-sm text-amber-900">
            This drink needs a crate type before stock can be received.
          </p>
          <Link className="quiet-link mt-3 inline-block" href={`/products/${product.id}/edit`}>
            Edit drink setup →
          </Link>
        </div>
      ) : (
        <ReceiveStockForm
          productId={product.id}
          requestId={randomUUID()}
          bottlesPerCrate={product.bottles_per_crate}
          availableEmpties={availableEmpties}
          recordedStock={stockResult.data?.total_bottles ?? 0}
        />
      )}
      <Link className="quiet-link mt-5" href="/stock/receive">
        Choose another product
      </Link>
    </>
  );
}
