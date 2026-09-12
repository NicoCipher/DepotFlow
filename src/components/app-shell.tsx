import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-8 pt-7 sm:pt-12">
      <a href="#main" className="sr-only focus:not-sr-only focus:rounded focus:p-3">Skip to content</a>
      <header className="flex items-center gap-3 border-b border-stone-200 pb-6">
        <span aria-hidden="true" className="grid size-11 place-items-center rounded-2xl bg-emerald-900 text-xl font-bold text-white">D</span>
        <p className="text-xl font-semibold tracking-tight">DepotFlow</p>
      </header>
      <main id="main" className="flex flex-1 flex-col pt-9">{children}</main>
    </div>
  );
}
