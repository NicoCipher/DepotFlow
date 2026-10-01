import { getCrateTypes } from "@/lib/crate-types/data";
import { randomUUID } from "node:crypto";
import { requireOwner } from "@/lib/auth/owner";
import { ProductForm } from "@/components/product-form";
import { emptyProduct, isProductId } from "@/domain/products";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";

export default async function NewProductPage({ searchParams }: {
  searchParams: Promise<{ catalogue?: string }>;
}) {
  const supabase = await requireOwner();
  const { catalogue } = await searchParams;
  const initialValues = { ...emptyProduct };
  if (catalogue) {
    if (!isProductId(catalogue)) notFound();
    const [drink, existing] = await Promise.all([
      supabase.from("product_catalogue").select("name").eq("id", catalogue).maybeSingle(),
      supabase.from("products").select("id").eq("catalogue_product_id", catalogue).maybeSingle(),
    ]);
    if (drink.error || existing.error) throw new Error("Could not load this drink. Please try again.");
    if (!drink.data) notFound();
    if (existing.data) redirect(`/products/${existing.data.id}/edit`);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());
    const price = await supabase.from("product_selling_price_history")
      .select("selling_price").eq("catalogue_product_id", catalogue)
      .lte("effective_on", today).order("effective_on", { ascending: false })
      .order("recorded_at", { ascending: false }).order("edit_order", { ascending: false })
      .limit(1).maybeSingle();
    if (price.error) throw new Error("Could not load the selling price. Please try again.");
    initialValues.name = drink.data.name;
    initialValues.full_crate_price = price.data ? String(price.data.selling_price) : "";
  }
  const crateTypes = await getCrateTypes();
  return (
    <>
      <Link href="/products/catalogue" className="quiet-link inline-flex">← Choose a drink</Link>
      <h1 className="mt-5">{catalogue ? `Set up ${initialValues.name}` : "Add your own drink"}</h1>
      {catalogue && <p className="mt-3 text-stone-600">{initialValues.full_crate_price
        ? "The name and selling price are filled in. Check them, then complete the crate and bottle details."
        : "The name is filled in. Enter your selling price, then complete the crate and bottle details."}</p>}
      <ProductForm crateTypes={crateTypes} id={randomUUID()}
        initialValues={initialValues} catalogueProductId={catalogue} />
    </>
  );
}
