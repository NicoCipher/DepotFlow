import { getCrateTypes } from "@/lib/crate-types/data";
import { randomUUID } from "node:crypto";
import { requireOwner } from "@/lib/auth/owner";
import { ProductForm } from "@/components/product-form";
import { emptyProduct } from "@/domain/products";
export default async function NewProductPage() {
  await requireOwner();
  const crateTypes = await getCrateTypes();
  return (
    <>
      <h1>Add Product</h1>
      <ProductForm
        crateTypes={crateTypes}
        id={randomUUID()}
        initialValues={emptyProduct}
      />
    </>
  );
}
