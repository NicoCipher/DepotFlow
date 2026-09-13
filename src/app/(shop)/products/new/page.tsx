import { randomUUID } from "node:crypto";
import { requireOwner } from "@/lib/auth/owner";
import { ProductForm } from "@/components/product-form";
import { emptyProduct } from "@/domain/products";
export default async function NewProductPage() {
  await requireOwner();
  return (
    <>
      <h1>Add Product</h1>
      <ProductForm id={randomUUID()} initialValues={emptyProduct} />
    </>
  );
}
