import { requireOwnerSession } from "@/lib/auth/owner";
import { loadSaleCatalog } from "./actions";
import { SaleBuilder } from "@/components/sale-builder";

export default async function RecordSalePage() {
  const { user } = await requireOwnerSession();
  const catalog = await loadSaleCatalog();
  return <SaleBuilder ownerId={user.id} initialCatalog={catalog} />;
}
