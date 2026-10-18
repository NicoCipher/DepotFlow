import type { ReactNode } from "react";
import { ThemeSelect } from "@/components/theme-select";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-7xl flex-col px-4 pb-28 pt-4 sm:px-6 sm:pb-8 sm:pt-7 lg:px-8 xl:px-10">
      <a href="#main" className="sr-only focus:not-sr-only focus:rounded focus:p-3">Skip to content</a>
      <header className="flex items-center gap-3 border-b border-stone-200/80 pb-4">
        <span aria-hidden="true" className="grid size-10 place-items-center rounded-xl bg-[#084b39] text-lg font-bold text-white shadow-sm">D</span>
        <p className="text-xl font-extrabold tracking-tight text-emerald-950">DepotFlow</p>
        <ThemeSelect />
      </header>
      <main id="main" className="flex min-w-0 flex-1 flex-col pt-5 sm:pt-6">{children}</main>
    </div>
  );
}
