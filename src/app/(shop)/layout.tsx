import { requireOwner } from "@/lib/auth/owner";
import { ShopNavigation } from "@/components/shop-navigation";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  await requireOwner();
  return <><ShopNavigation />{children}</>;
}
