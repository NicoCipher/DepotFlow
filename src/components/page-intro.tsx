import type { ReactNode } from "react";

export function PageIntro({
  title,
  description,
  eyebrow,
  action,
}: {
  title: string;
  description: string;
  eyebrow?: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6">
      {eyebrow && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-800">
          {eyebrow}
        </p>
      )}
      <h1 className="break-words">{title}</h1>
      <p className="mt-2 max-w-md text-sm leading-6 text-stone-600">
        {description}
      </p>
      {action && <div className="mt-4">{action}</div>}
    </header>
  );
}
