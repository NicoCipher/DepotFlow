import "server-only";
import { requireOwner } from "@/lib/auth/owner";
import type { CrateType } from "@/domain/crate-types";
export async function getCrateTypes() {
  const supabase = await requireOwner();
  const types: CrateType[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("crate_types")
      .select("*")
      .order("name")
      .order("id")
      .range(offset, offset + 999);
    if (error) throw new Error("Could not load crate types.");
    types.push(...data);
    if (data.length < 1000) return types;
  }
}
