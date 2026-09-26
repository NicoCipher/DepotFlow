import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { signOut } from "@/app/sign-in/actions";

export default async function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireOwner();
  return (
    <>
      <nav
        aria-label="Shop"
        className="mb-6 border-b border-stone-200 pb-3"
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link className="quiet-link" href="/">
            Home
          </Link>
          <Link className="quiet-link" href="/customers">
            Customers
          </Link>
          <Link className="quiet-link" href="/stock">
            Stock
          </Link>
          <form action={signOut} className="ml-auto">
            <button className="quiet-link">Sign out</button>
          </form>
        </div>
        <details>
          <summary className="quiet-link inline cursor-pointer">
            Manage
          </summary>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pb-1 pl-1">
            <Link className="quiet-link" href="/sales">
              Sales History
            </Link>
            <Link className="quiet-link" href="/products">
              Products
            </Link>
          </div>
        </details>
      </nav>
      {children}
    </>
  );
}
