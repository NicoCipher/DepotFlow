import Link from "next/link";
import { formatNaira } from "@/domain/products";
import { methodLabel } from "@/lib/receipts";
import { recordListView } from "@/domain/record-list";
import type { CustomerRecord } from "@/domain/records";

function recordTime(value: string) {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

function KindIcon({ kind }: { kind: CustomerRecord["kind"] }) {
  return (
    <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      {kind === "sale" ? <><path d="M7 3h10l2 2v16l-3-2-4 2-4-2-3 2V5z"/><path d="M9 9h6M9 13h6"/></>
      : kind === "payment" ? <><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 15h2"/></>
      : kind === "empties" ? <><path d="M7 8 12 5l5 3v11l-5 3zM7 8l5 3 5-3M12 11v11M9 3h6"/></>
      : <><path d="M7 3h10v18H7zM10 8h4M10 12h4M10 16h2"/></>}
    </svg>
  );
}

function Amount({ amount, label, voided }: { amount: number; label: string; voided: boolean }) {
  return (
    <div className="shrink-0 text-right">
      <p className={`whitespace-nowrap text-[18px] font-extrabold leading-6 tracking-tight tabular-nums sm:text-xl ${voided ? "text-red-800" : "text-stone-950"}`}>
        {formatNaira(amount)}
      </p>
      <p className="mt-1 text-[10px] font-semibold leading-4 text-stone-500">{label}</p>
    </div>
  );
}

function RecordSummary({ item }: { item: CustomerRecord }) {
  const view = recordListView(item);
  if (view.combined) {
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs leading-5 text-stone-600">
        <span><b className="font-semibold text-stone-700">Sale</b> {formatNaira(item.sale_total)}</span>
        <span><b className="font-semibold text-stone-700">Paid on sale</b> {formatNaira(item.received)}</span>
        <span><b className="font-semibold text-stone-700">Old debt paid</b> {formatNaira(item.old_debt_paid)}</span>
        {item.method && <span className="font-semibold text-emerald-800">{methodLabel(item.method)}</span>}
      </div>
    );
  }

  if (view.sale) {
    return (
      <div className="text-xs leading-5 text-stone-600">
        <span>
          {item.received > 0
            ? `${view.voided ? "Historical payment" : "Paid at sale"} ${formatNaira(item.received)}${item.method ? ` · ${methodLabel(item.method)}` : ""}`
            : "No payment at sale"}
          {item.remaining > 0 && !view.voided ? ` · ${formatNaira(item.remaining)} owed after sale` : ""}
        </span>
        {view.linkedPaymentVoided && (
          <span className="mt-1 block font-semibold text-red-800">
            Old-debt payment voided. Check its separate receipt.
          </span>
        )}
      </div>
    );
  }

  if (view.payment) {
    return (
      <p className="text-xs leading-5 text-stone-600">
        {view.voided ? "Voided receipt" : methodLabel(item.method ?? "not_recorded")}
        {" · "}Balance after: {formatNaira(item.remaining)}
        {view.paymentDuringSale ? " · During purchase" : ""}
      </p>
    );
  }

  if (view.empties) {
    const returned = item.crates > 0 || item.bottles > 0;
    const collected = item.held_crates > 0 || item.held_bottles > 0;
    return (
      <p className="text-xs leading-5 text-stone-600">
        {returned && `Returned: ${item.crates} crates · ${item.bottles} bottles`}
        {returned && collected ? " · " : ""}
        {collected && `Customer collected: ${item.held_crates} held crates · ${item.held_bottles} held bottles`}
      </p>
    );
  }

  return (
    <p className="text-xs leading-5 text-stone-600">
      {item.crates || item.bottles
        ? `Starting empties: ${item.crates} crates · ${item.bottles} bottles`
        : "Balance brought forward"}
    </p>
  );
}

export function RecordHistoryRow({ item }: { item: CustomerRecord }) {
  const view = recordListView(item);
  const badge = view.tone === "danger" ? "bg-red-50 text-red-800"
    : view.tone === "warning" ? "bg-amber-50 text-amber-900"
    : view.tone === "success" ? "bg-emerald-50 text-emerald-800"
    : "bg-stone-100 text-stone-600";
  const iconColor = view.voided || view.linkedPaymentVoided ? "bg-red-50 text-red-800"
    : item.kind === "payment" ? "bg-emerald-50 text-emerald-800"
    : item.kind === "sale" ? "bg-sky-50 text-sky-800"
    : item.kind === "empties" ? "bg-amber-50 text-amber-900"
    : "bg-violet-50 text-violet-800";
  const href = item.kind === "opening" ? `/records/opening/${item.id}` : item.detail;

  return (
    <li>
      <Link href={href}
        className="group block px-3 py-3.5 transition-colors hover:bg-emerald-50/40 focus-visible:bg-emerald-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-emerald-700 sm:px-5 sm:py-4">
        <div className="grid grid-cols-[2.25rem_minmax(0,1fr)] items-start gap-x-3 sm:grid-cols-[2.5rem_minmax(0,1fr)]">
          <span className={`grid size-9 place-items-center rounded-xl sm:size-10 ${iconColor}`}>
            <KindIcon kind={item.kind}/>
          </span>
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 text-[10px] font-extrabold uppercase tracking-[.09em] leading-4 text-stone-500">
                {view.label}
              </span>
              <time dateTime={item.created_at} className="shrink-0 text-[11px] font-medium tabular-nums text-stone-500">
                {recordTime(item.created_at)}
              </time>
            </div>
            <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
              <div className="min-w-0">
                <p className="break-words text-[15px] font-extrabold leading-5 text-stone-950 sm:text-base">
                  {item.customer_name}
                </p>
                {item.business_name && item.business_name !== item.customer_name &&
                  <p className="mt-0.5 truncate text-xs leading-4 text-stone-500">{item.business_name}</p>}
              </div>
              {view.money !== null &&
                <Amount amount={view.money} label={view.moneyLabel} voided={view.voided}/>}
            </div>
            <div className="mt-2">
              <RecordSummary item={item}/>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold leading-4 ${badge}`}>
                {view.combined && item.checkout_balance !== null && item.checkout_balance > 0
                  ? `Balance after ${formatNaira(item.checkout_balance)}`
                  : view.status}
              </span>
              <span className="flex min-w-0 items-center gap-1 text-[10px] font-semibold text-stone-400">
                {item.receipt_number && <span className="truncate">{item.receipt_number}</span>}
                <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
                  strokeLinejoin="round" className="shrink-0 text-stone-400 transition-transform group-hover:translate-x-0.5">
                  <path d="m9 18 6-6-6-6"/>
                </svg>
              </span>
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}
