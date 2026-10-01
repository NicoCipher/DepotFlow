import Link from "next/link";
import { getCrateTypes } from "@/lib/crate-types/data";
import { getProduct } from "@/lib/products/data";
import { ProductForm } from "@/components/product-form";
import { productValues } from "@/domain/products";
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const product = await getProduct((await params).id);
  const crateTypes = await getCrateTypes();
  return (
    <>
      <Link href={`/products/${product.id}`} className="quiet-link inline-flex">← Drink details</Link>
      <h1 className="mt-5 break-words">Edit {product.name}</h1>
      {product.size && <p className="mt-2 text-stone-600">{product.size}</p>}
      <ProductForm
        crateTypes={crateTypes}
        id={product.id}
        editing
        initialValues={productValues(product)}
      />
    </>
  );
}
