"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/app/sign-in/actions";

const sections = [
  { href: "/", label: "Home" },
  { href: "/record-sale", label: "Record Sale" },
  { href: "/customers", label: "Customers" },
  { href: "/stock", label: "Stock" },
] as const;

export function ShopNavigation() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  const moreLinks = [
    { href: "/sales", label: "Sales History" },
    { href: "/products", label: "Products" },
    { href: "/empty-crates", label: "Empty Crates" },
    { href: "/empties-rules", label: "Empties Rules" },
  ];
  return (
    <nav aria-label="Shop" className="mb-5 border-b border-stone-200 pb-2">
      <div className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {sections.map(({ href, label }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? "page" : undefined}
            className={`flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-semibold ${active(href) ? "bg-emerald-900 text-white" : "text-emerald-950"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <details key={pathname} open={moreLinks.some(({ href }) => active(href)) || pathname.startsWith("/crate-types")}>
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-emerald-900">More</summary>
        <div className="grid grid-cols-2 gap-x-4 border-t border-stone-200 pb-2 pt-1">
          {moreLinks.map(({ href, label }) => (
            <Link key={href} className="quiet-link" href={href} aria-current={active(href) ? "page" : undefined}>{label}</Link>
          ))}
          <form action={signOut}><button className="quiet-link">Sign out</button></form>
        </div>
      </details>
    </nav>
  );
}
