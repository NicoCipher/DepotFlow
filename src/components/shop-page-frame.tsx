"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const widePages = new Set([
  "/",
  "/activity",
  "/records",
  "/customers",
  "/customers/archived",
  "/products",
  "/products/catalogue",
  "/sales",
  "/stock",
  "/empties",
  "/empty-crates",
]);

export function ShopPageFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const wide = widePages.has(pathname);
  const sale = pathname === "/record-sale";
  const customerAccount = /^\/customers\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(pathname);
  return (
    <div className={`mx-auto w-full ${wide ? "max-w-6xl" : customerAccount ? "max-w-5xl" : sale ? "max-w-3xl" : "max-w-xl"}`}>
      {children}
    </div>
  );
}
