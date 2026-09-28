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

function NavigationIcon({ kind }: { kind: "Home" | "Record Sale" | "Customers" | "Stock" | "More" }) {
  const paths = {
    Home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z" /><path d="M9 21v-7h6v7" /></>,
    "Record Sale": <><path d="M4 4h16v16H4z" /><path d="M8 9h8M8 13h8M8 17h4" /></>,
    Customers: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 6a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" /></>,
    Stock: <><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z" /><path d="m3 7 9 4 9-4M12 11v10" /></>,
    More: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  };
  return <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[kind]}</svg>;
}

export function ShopNavigation() {
  const pathname = usePathname();
  const active = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  const moreLinks = [
    { href: "/activity", label: "Activity" },
    { href: "/sales", label: "Sales History" },
    { href: "/products", label: "Products" },
    { href: "/empty-crates", label: "Empty Crates" },
    { href: "/empties-rules", label: "Empties Rules" },
  ];
  const moreActive = moreLinks.some(({ href }) => active(href)) || pathname.startsWith("/crate-types");
  return <>
    <nav aria-label="Shop" className="mb-5 hidden border-b border-stone-200 pb-2 sm:block">
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
      <details key={pathname} open={moreActive}>
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium text-emerald-900">More</summary>
        <div className="grid grid-cols-2 gap-x-4 border-t border-stone-200 pb-2 pt-1">
          {moreLinks.map(({ href, label }) => (
            <Link key={href} className="quiet-link" href={href} aria-current={active(href) ? "page" : undefined}>{label}</Link>
          ))}
          <form action={signOut}><button className="quiet-link">Sign out</button></form>
        </div>
      </details>
    </nav>
    <nav aria-label="Mobile shop" className="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white shadow-[0_-4px_24px_rgba(0,0,0,0.08)] sm:hidden">
      <div className="mx-auto flex max-w-xl items-stretch justify-around px-1 pb-[env(safe-area-inset-bottom)]">
        {sections.map(({ href, label }) => (
          <Link key={href} href={href} aria-current={active(href) ? "page" : undefined} className={`flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 text-center text-[11px] font-semibold leading-tight ${active(href) ? "text-emerald-900" : "text-stone-600"}`}>
            <NavigationIcon kind={label} />
            <span>{label}</span>
          </Link>
        ))}
        <details key={pathname} className="group relative flex min-w-0 flex-1">
          <summary className={`flex min-h-16 w-full cursor-pointer list-none flex-col items-center justify-center gap-1 px-1 text-center text-[11px] font-semibold leading-tight [&::-webkit-details-marker]:hidden ${moreActive ? "text-emerald-900" : "text-stone-600"}`} aria-label="More shop pages">
            <NavigationIcon kind="More" />
            <span>More</span>
          </summary>
          <div className="absolute bottom-full right-0 mb-2 w-[min(19rem,90vw)] rounded-xl border border-stone-200 bg-white p-3 shadow-xl">
            <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">More pages</p>
            {moreLinks.map(({ href, label }) => <Link key={href} href={href} aria-current={active(href) ? "page" : undefined} className={`block min-h-12 rounded-lg px-3 py-3 font-medium ${active(href) ? "bg-emerald-50 text-emerald-900" : "text-stone-800"}`}>{label}</Link>)}
            <form action={signOut} className="border-t border-stone-200 pt-2"><button className="w-full rounded-lg px-3 py-3 text-left text-stone-700">Sign out</button></form>
          </div>
        </details>
      </div>
    </nav>
  </>;
}
