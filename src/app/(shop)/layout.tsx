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
        className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-stone-200 pb-3"
      >
        <Link className="quiet-link" href="/">
          Home
        </Link>
        <Link className="quiet-link" href="/customers">
          Customers
        </Link>
        <Link className="quiet-link" href="/sales">
          Sales
        </Link>
        <Link className="quiet-link" href="/products">
          Products
        </Link>
        <Link className="quiet-link" href="/stock">
          Stock
        </Link>
        <form action={signOut} className="ml-auto">
          <button className="quiet-link">Sign out</button>
        </form>
      </nav>
      {children}
    </>
  );
}
