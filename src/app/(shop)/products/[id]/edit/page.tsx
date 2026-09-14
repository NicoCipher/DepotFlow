import { randomUUID } from "node:crypto";
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
      <h1>Edit product</h1>
      <ProductForm
        crateTypes={crateTypes}
        crateRequestId={randomUUID()}
        id={product.id}
        editing
        initialValues={productValues(product)}
      />
    </>
  );
}
