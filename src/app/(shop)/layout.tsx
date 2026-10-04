import { requireOwner } from "@/lib/auth/owner";
import { ShopNavigation } from "@/components/shop-navigation";
import { ShopPageFrame } from "@/components/shop-page-frame";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  await requireOwner();
  return (
    <>
      <ShopNavigation />
      <ShopPageFrame>{children}</ShopPageFrame>
    </>
  );
}
