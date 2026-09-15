import { requireOwner } from "@/lib/auth/owner";
import { loadSaleCatalog } from "./actions";
import { SaleBuilder } from "@/components/sale-builder";
export default async function RecordSalePage() {
  const supabase = await requireOwner();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again.");
  return (
    <SaleBuilder ownerId={user.id} initialCatalog={await loadSaleCatalog()} />
  );
}
