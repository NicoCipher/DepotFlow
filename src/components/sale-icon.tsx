import type { ReactNode } from "react";

type SaleIconName =
  | "pause"
  | "trash"
  | "check"
  | "arrow"
  | "user"
  | "plus"
  | "bag"
  | "receipt"
  | "edit"
  | "shield"
  | "cash"
  | "transfer"
  | "pos"
  | "split";

export function SaleIcon({
  name,
  className = "h-5 w-5",
}: {
  name: SaleIconName;
  className?: string;
}) {
  const drawings: Record<SaleIconName, ReactNode> = {
    pause: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M10 8v8M14 8v8" />
      </>
    ),
    trash: (
      <>
        <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    bag: (
      <>
        <path d="M4 8h16l-1 13H5L4 8Z" />
        <path d="M9 9V6a3 3 0 0 1 6 0v3" />
      </>
    ),
    receipt: (
      <>
        <path d="M5 3h14v18l-3-2-4 2-4-2-3 2V3Z" />
        <path d="M9 8h6M9 12h6M9 16h3" />
      </>
    ),
    edit: (
      <>
        <path d="m4 16-1 5 5-1L19 9l-4-4L4 16Z" />
        <path d="m13 7 4 4" />
      </>
    ),
    cash: (
      <>
        <rect x="2.5" y="5" width="19" height="14" rx="2" />
        <circle cx="12" cy="12" r="3" />
        <path d="M5.5 9h1M17.5 15h1" />
      </>
    ),
    transfer: (
      <>
        <path d="M3 9h18L12 4 3 9ZM5 9v9M10 9v9M14 9v9M19 9v9M3 20h18" />
      </>
    ),
    pos: (
      <>
        <rect x="5" y="2" width="14" height="20" rx="2" />
        <path d="M8 6h8v5H8zM8 15h2M14 15h2M8 18h2M14 18h2" />
      </>
    ),
    split: (
      <>
        <path d="M4 5h8a4 4 0 0 1 4 4v10M16 19l-3-3m3 3 3-3M4 19h4a4 4 0 0 0 4-4v-4M12 11l-3 3m3-3 3 3" />
      </>
    ),
    shield: (
      <>
        <path d="m12 2 8 4v6c0 5-3 8-8 10-5-2-8-5-8-10V6l8-4Z" />
        <path d="m8.5 12 2.5 2.5 4.5-5" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {drawings[name]}
    </svg>
  );
}
