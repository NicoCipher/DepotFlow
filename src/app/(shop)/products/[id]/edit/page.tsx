import { getProduct } from "@/lib/products/data";
import { ProductForm } from "@/components/product-form";
import { productValues } from "@/domain/products";
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const product = await getProduct((await params).id);
  return (
    <>
      <h1>Edit product</h1>
      <ProductForm
        id={product.id}
        editing
        initialValues={productValues(product)}
      />
    </>
  );
}
