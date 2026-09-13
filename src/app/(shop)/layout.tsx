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
        className="mb-6 flex items-center gap-4 border-b border-stone-200 pb-3"
      >
        <Link className="quiet-link" href="/">
          Home
        </Link>
        <Link className="quiet-link" href="/customers">
          Customers
        </Link>
        <form action={signOut} className="ml-auto">
          <button className="quiet-link">Sign out</button>
        </form>
      </nav>
      {children}
    </>
  );
}
