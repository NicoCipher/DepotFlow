import Link from "next/link";
import { randomUUID } from "node:crypto";
import { requireOwner } from "@/lib/auth/owner";
import { CrateTypeForm } from "@/components/crate-type-form";
export default async function NewCrateTypePage() {
  await requireOwner();
  return (
    <>
      <Link href="/crate-types" className="quiet-link inline-flex">← Crates</Link>
      <h1 className="mt-5">Add crate</h1>
      <CrateTypeForm
        id={randomUUID()}
        initial={{ name: "", empty_family: "", pocket_count: "", variant: "" }}
      />
    </>
  );
}
