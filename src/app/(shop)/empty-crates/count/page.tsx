import { crateLabel } from "@/domain/crate-types";
import { isProductId } from "@/domain/products";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { EmptyCrateCountForm } from "@/components/empty-crate-count-form";

export default async function EmptyCrateCountPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const supabase = await requireOwner();
  const crateTypeId = (await searchParams).type;
  if (typeof crateTypeId !== "string" || !isProductId(crateTypeId)) notFound();
  const { data, error } = await supabase
    .from("known_empty_crates")
    .select("*")
    .eq("crate_type_id", crateTypeId)
    .maybeSingle();
  if (error) throw new Error("Could not load empty crates.");
  if (!data?.crate_type_id) notFound();
  return (
    <>
      <h1>Set Current Count</h1>
      <h2 className="mt-5 break-words text-xl font-semibold">
        {crateLabel(data)}
      </h2>
      <p className="mt-2 text-stone-600">
        Count the empty crates physically in the shop now.
      </p>
      <EmptyCrateCountForm
        key={data.crate_type_id}
        crateTypeId={data.crate_type_id}
        requestId={randomUUID()}
      />
      <Link className="quiet-link mt-5 inline-block" href="/empty-crates">
        Choose another crate type
      </Link>
    </>
  );
}
