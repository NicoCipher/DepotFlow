import { requireOwner } from "@/lib/auth/owner";
import { loadSaleCatalog } from "../actions";
import { PausedSales } from "@/components/paused-sales";
export default async function PausedSalesPage() {
  const supabase = await requireOwner();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again.");
  return (
    <PausedSales ownerId={user.id} initialCatalog={await loadSaleCatalog()} />
  );
}
