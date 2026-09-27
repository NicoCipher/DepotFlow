import { requireOwnerSession } from "@/lib/auth/owner";
import { loadSaleCatalog } from "../actions";
import { PausedSales } from "@/components/paused-sales";

export default async function PausedSalesPage() {
  const { user } = await requireOwnerSession();
  const catalog = await loadSaleCatalog();
  return <PausedSales ownerId={user.id} initialCatalog={catalog} />;
}
