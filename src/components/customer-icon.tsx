import type { ReactNode } from "react";

type Name = "money" | "crate" | "bottle" | "history" | "phone" | "arrow" | "check" | "return" | "person";

export function CustomerIcon({ name, className = "h-5 w-5" }: { name: Name; className?: string }) {
  const parts: Record<Name, ReactNode> = {
    money: <><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 10h20M6 3h12" /><circle cx="12" cy="14.5" r="2" /></>,
    crate: <><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z" /><path d="m3 7 9 4 9-4M12 11v10M7 9v10M17 9v10" /></>,
    bottle: <><path d="M10 2h4v4l2 3v11a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2V9l2-3V2Z" /><path d="M8 12h8M8 17h8" /></>,
    history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    phone: <path d="M6.5 3H4a2 2 0 0 0-2 2c0 9.4 7.6 17 17 17a2 2 0 0 0 2-2v-2.5l-5-2-2.5 2.5a16 16 0 0 1-7.5-7.5L8.5 8Z" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
    return: <><path d="M4 8h10a6 6 0 0 1 0 12h-3M4 8l5-5M4 8l5 5" /></>,
    person: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {parts[name]}
    </svg>
  );
}
