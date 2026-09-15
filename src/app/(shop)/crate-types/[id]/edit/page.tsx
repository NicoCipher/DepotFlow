import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { isProductId } from "@/domain/products";
import { notFound } from "next/navigation";
import { CrateTypeForm } from "@/components/crate-type-form";
export default async function EditCrateTypePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await requireOwner();
  const { id } = await params;
  if (!isProductId(id)) notFound();
  const { data, error } = await supabase
    .from("crate_types")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Could not load crate type.");
  if (!data) notFound();
  if (data.is_legacy)
    return (
      <>
        <h1>{data.name}</h1>
        <p className="mt-3">Needs setup</p>
        <Link className="primary mt-5 w-full" href="/crate-types/new">
          Create exact crate type
        </Link>
        <Link className="quiet-link mt-3" href="/products">
          Choose a crate on each product
        </Link>
      </>
    );
  return (
    <>
      <h1>Edit crate type</h1>
      <CrateTypeForm
        id={id}
        editing
        initial={{
          name: data.name,
          empty_family: data.empty_family ?? "",
          pocket_count: data.pocket_count?.toString() ?? "",
          variant: data.variant ?? "",
        }}
      />
    </>
  );
}
