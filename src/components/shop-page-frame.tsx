"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const widePages = new Set([
  "/",
  "/activity",
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
  return (
    <div className={`mx-auto w-full ${wide ? "max-w-6xl" : sale ? "max-w-3xl" : "max-w-xl"}`}>
      {children}
    </div>
  );
}
