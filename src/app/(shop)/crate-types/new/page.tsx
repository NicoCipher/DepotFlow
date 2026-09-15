import { randomUUID } from "node:crypto";
import { requireOwner } from "@/lib/auth/owner";
import { CrateTypeForm } from "@/components/crate-type-form";
export default async function NewCrateTypePage() {
  await requireOwner();
  return (
    <>
      <h1>Add crate type</h1>
      <CrateTypeForm
        id={randomUUID()}
        initial={{ name: "", empty_family: "", pocket_count: "", variant: "" }}
      />
    </>
  );
}
