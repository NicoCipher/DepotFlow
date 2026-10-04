import type { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-28 pt-4 sm:px-6 sm:pb-8 sm:pt-8">
      <a href="#main" className="sr-only focus:not-sr-only focus:rounded focus:p-3">Skip to content</a>
      <header className="flex items-center gap-2 border-b border-stone-200 pb-3">
        <span aria-hidden="true" className="grid size-9 place-items-center rounded-xl bg-emerald-900 text-lg font-bold text-white">D</span>
        <p className="text-lg font-semibold tracking-tight">DepotFlow</p>
      </header>
      <main id="main" className="flex flex-1 flex-col pt-5">{children}</main>
    </div>
  );
}
