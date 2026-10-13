import Link from "next/link";
import type { ReactNode } from "react";
import { PausedSalesLink } from "@/components/paused-sales-link";
import { formatNaira } from "@/domain/products";

export type HomeSnapshot = {
  sales_count: number;
  sales_value: number;
  received: number;
  outstanding: number;
  customers_owing: number;
  low_stock: number;
  missing_counts: number;
};

type IconName =
  | "arrow" | "cart" | "wallet" | "sales" | "receive" | "payment"
  | "count" | "empties" | "clock" | "warning" | "people" | "activity"
  | "check" | "box" | "settings";

function HomeIcon({ name, size = 22 }: { name: IconName; size?: number }) {
  const shapes: Record<IconName, ReactNode> = {
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    cart: <><circle cx="9" cy="20" r="1" /><circle cx="19" cy="20" r="1" /><path d="M2 3h2l2.5 12.5a2 2 0 0 0 2 1.5h10a2 2 0 0 0 2-1.5L22 7H5" /></>,
    wallet: <><rect x="3" y="5" width="18" height="15" rx="3" /><path d="M3 9h18m-5 5h2" /></>,
    sales: <><rect x="5" y="2.5" width="14" height="19" rx="2" /><path d="M8 7h8M8 11h8m-8 4h5" /></>,
    receive: <><path d="m3 8 9-5 9 5v10l-9 5-9-5V8Z" /><path d="m3 8 9 5 9-5M12 13v10m0-20v7" /></>,
    payment: <><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="M2.5 10h19m-14 5h4" /></>,
    count: <><path d="M8 4h-3a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3" /><rect x="8" y="2" width="8" height="4" rx="1" /><path d="m8 13 2 2 4-4m2 3h2M8 19h10" /></>,
    empties: <><path d="M9 3h6l2 4v13a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7l2-4Z" /><path d="M7 10h10M9 3v4h6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    warning: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5m0 3h.01" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 6a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" /></>,
    activity: <><path d="M3 12h4l3-7 4 14 3-7h4" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
    box: <><path d="m3 7 9-4 9 4v10l-9 4-9-4V7Z" /><path d="m3 7 9 4 9-4M12 11v10" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9 7 7m10 10 2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" /></>,
  };
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      {shapes[name]}
    </svg>
  );
}

const quickActions: { href: string; icon: IconName; title: string; description: string; colour: string }[] = [
  { href: "/stock/receive", icon: "receive", title: "Receive stock", description: "Add a delivery", colour: "bg-emerald-50 text-emerald-800" },
  { href: "/customers", icon: "payment", title: "Record payment", description: "Choose a customer", colour: "bg-blue-50 text-blue-800" },
  { href: "/stock/count", icon: "count", title: "Count stock", description: "Check what is here", colour: "bg-amber-50 text-amber-800" },
  { href: "/empties", icon: "empties", title: "Customer empties", description: "Crates & bottles owed", colour: "bg-violet-50 text-violet-800" },
];

function QuickAction({ action }: { action: (typeof quickActions)[number] }) {
  return (
    <Link href={action.href}
      className="group flex min-h-[124px] min-w-0 flex-col justify-between rounded-2xl border border-stone-200/90 bg-white p-4 shadow-[0_2px_8px_rgba(22,40,30,0.025)] transition-[border-color,box-shadow,transform] motion-safe:hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md focus-visible:outline-emerald-700 sm:min-h-[132px] sm:p-4">
      <span className={`inline-grid size-11 place-items-center rounded-xl ${action.colour}`}>
        <HomeIcon name={action.icon} size={23} />
      </span>
      <span className="mt-4 flex min-w-0 items-end justify-between gap-1">
        <span className="min-w-0">
          <strong className="block text-[15px] font-bold leading-5 text-stone-950 sm:text-base">{action.title}</strong>
          <span className="mt-1 block text-xs leading-4 text-stone-600 sm:text-sm">{action.description}</span>
        </span>
        <span className="shrink-0 text-emerald-800 motion-safe:transition-transform motion-safe:group-hover:translate-x-1"><HomeIcon name="arrow" size={18}/></span>
      </span>
    </Link>
  );
}

function AttentionRow({
  href, icon, title, description, value, warm = false,
}: {
  href: string; icon: IconName; title: string; description: string; value: string; warm?: boolean;
}) {
  return (
    <Link href={href} className={`group flex min-h-20 min-w-0 items-center gap-3 px-4 py-3 transition-colors hover:bg-stone-50 focus-visible:relative focus-visible:z-10 sm:px-5 ${warm ? "bg-amber-50/65 hover:bg-amber-50" : "bg-white"}`}>
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${warm ? "bg-amber-100 text-amber-800" : "bg-stone-100 text-stone-700"}`}>
        <HomeIcon name={icon} size={20}/>
      </span>
      <span className="min-w-0 flex-1">
        <strong className="block text-sm font-bold leading-5 text-stone-900 sm:text-[15px]">{title}</strong>
        <span className="mt-0.5 block text-xs leading-4 text-stone-600 sm:text-[13px]">{description}</span>
      </span>
      <span className="flex min-w-0 max-w-[45%] shrink-0 items-center gap-2">
        <strong className="min-w-0 break-words text-right text-sm font-bold leading-5 text-emerald-900 sm:text-base">{value}</strong>
        <span className="shrink-0 text-stone-500 group-hover:text-emerald-800"><HomeIcon name="arrow" size={17}/></span>
      </span>
    </Link>
  );
}

export function HomeDashboard({
  ownerId, dayLabel, refreshedAt, snapshot, emptiesCustomers, heldCrates, heldBottles, drinksNeedingSetup,
}: {
  ownerId: string;
  dayLabel: string;
  refreshedAt: string;
  snapshot: HomeSnapshot;
  emptiesCustomers: number;
  heldCrates: number;
  heldBottles: number;
  drinksNeedingSetup: number;
}) {
  const hasHeldEmpties = heldCrates > 0 || heldBottles > 0;
  const lowStockOnly = Math.max(0, snapshot.low_stock - snapshot.missing_counts);
  const attentionCount =
    Number(snapshot.customers_owing > 0) +
    Number(emptiesCustomers > 0) +
    Number(hasHeldEmpties) +
    Number(lowStockOnly > 0) +
    Number(snapshot.missing_counts > 0) +
    Number(drinksNeedingSetup > 0);

  return (
    <div className="min-w-0 space-y-7 pb-5 sm:space-y-8 lg:space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-3 pb-1">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-800">{dayLabel}</p>
          <h1 className="mt-2 text-[clamp(1.9rem,4vw,2.75rem)] font-extrabold tracking-[-0.035em] text-stone-950">
            Your shop today
          </h1>
          <p className="mt-1 max-w-xl text-sm leading-6 text-stone-600 sm:text-base">
            Record sales, manage stock and check what needs your attention.
          </p>
        </div>
        <Link href="/activity" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm font-bold text-emerald-900 hover:border-emerald-300 hover:bg-emerald-50">
          <HomeIcon name="activity" size={18}/> View activity
        </Link>
      </header>

      <div className="grid min-w-0 gap-7 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] md:items-start md:gap-5 lg:gap-7">
        <div className="min-w-0 space-y-7">
        <section aria-label="Start a sale" className="flex min-w-0 flex-col gap-3">
          <Link href="/record-sale"
            className="group relative isolate flex min-h-[208px] flex-1 flex-col justify-between overflow-hidden rounded-[1.5rem] bg-[#084b39] p-5 text-white shadow-[0_12px_28px_rgba(5,54,40,0.14)] transition-[box-shadow,transform] motion-safe:hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(5,54,40,0.2)] sm:min-h-[225px] sm:p-6 md:min-h-[255px] xl:p-7">
            <span className="relative">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.13em] text-emerald-100">
                <HomeIcon name="cart" size={16}/> Start here
              </span>
              <span className="mt-4 block max-w-[20ch] text-[clamp(1.9rem,3.8vw,2.65rem)] font-extrabold leading-[1.07] tracking-[-0.04em] text-white">
                Record a sale
              </span>
              <span className="mt-3 block max-w-md text-sm leading-6 text-emerald-100/90 sm:text-base">
                Choose a customer, add drinks, check empties and take payment.
              </span>
            </span>
            <span className="relative mt-5 flex flex-wrap items-center justify-between gap-4">
              <span className="inline-flex min-h-12 items-center gap-3 rounded-xl bg-white px-5 py-3 text-sm font-extrabold text-emerald-950 transition-colors group-hover:bg-emerald-50 sm:text-base">
                Start sale <HomeIcon name="arrow" size={19}/>
              </span>
              <span className="hidden text-right text-xs font-medium text-emerald-100/75 sm:block">Customer → Drinks → Empties → Payment</span>
            </span>
          </Link>
          <PausedSalesLink ownerId={ownerId} prominent />
        </section>
        <section aria-labelledby="quick-heading" className="min-w-0">
          <div className="mb-4">
            <h2 id="quick-heading" className="text-lg font-extrabold tracking-tight text-stone-950 sm:text-xl">What would you like to do?</h2>
            <p className="mt-1 text-sm text-stone-600">The most common jobs, one tap away.</p>
          </div>
          <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4">
            {quickActions.map((action) => <QuickAction key={action.href} action={action}/>)}
          </div>
        </section>
        </div>
        <div className="min-w-0 space-y-7">
        <section aria-labelledby="money-heading" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 lg:mb-4">
            <div>
              <h2 id="money-heading" className="text-lg font-extrabold tracking-tight text-stone-950">Money today</h2>
              <p className="mt-0.5 text-xs text-stone-600">Checked at {refreshedAt} (Nigeria time)</p>
            </div>
            <div className="flex items-center gap-1">
              <a href="/" aria-label="Refresh today's shop numbers" className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-bold text-emerald-800 hover:bg-emerald-50">Refresh</a>
              <Link href="/sales" className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-bold text-emerald-800 hover:bg-emerald-50">
              View sales <HomeIcon name="arrow" size={17}/>
            </Link>
            </div>
          </div>
          <div className="grid min-w-0 gap-3 sm:grid-cols-2 md:grid-cols-1">
            <div className="flex min-w-0 flex-col justify-between rounded-2xl border border-emerald-200 bg-[#E7F3E9] p-5 sm:p-6">
              <span className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-emerald-950">Money received</span>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/65 text-emerald-800"><HomeIcon name="wallet" size={21}/></span>
              </span>
              <span className="mt-3 block min-w-0 break-words text-[clamp(1.65rem,3.15vw,2.45rem)] font-extrabold leading-tight tracking-[-0.045em] text-[#0C4B37] [overflow-wrap:anywhere]">{formatNaira(snapshot.received)}</span>
              <span className="mt-2 text-xs leading-5 text-emerald-900/90 sm:text-sm">Payments collected today, including old debts</span>
            </div>
            <div className="flex min-w-0 flex-col justify-between rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_2px_8px_rgba(22,40,30,0.025)] sm:p-6">
              <span className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-stone-800">Sales value</span>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#F6F2E9] text-stone-700"><HomeIcon name="sales" size={21}/></span>
              </span>
              <span className="mt-3 block min-w-0 break-words text-[clamp(1.65rem,3.15vw,2.45rem)] font-extrabold leading-tight tracking-[-0.045em] text-stone-950 [overflow-wrap:anywhere]">{formatNaira(snapshot.sales_value)}</span>
              <span className="mt-2 text-xs leading-5 text-stone-600 sm:text-sm">
                {snapshot.sales_count === 0 ? "No sales recorded today" : `${snapshot.sales_count} ${snapshot.sales_count === 1 ? "sale" : "sales"} recorded today`} · Includes unpaid sales
              </span>
            </div>
          </div>
        </section>
        <section aria-labelledby="attention-heading" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="attention-heading" className="text-lg font-extrabold tracking-tight text-stone-950 sm:text-xl">Needs attention</h2>
              <p className="mt-1 text-sm text-stone-600">Open an item to see the related records.</p>
            </div>
            {attentionCount > 0 && (
              <span className="rounded-full bg-amber-100 px-3 py-1.5 text-xs font-extrabold text-amber-900">
                {attentionCount} {attentionCount === 1 ? "item" : "items"}
              </span>
            )}
          </div>
          {attentionCount === 0 ? (
            <div className="flex min-h-48 items-center gap-4 rounded-2xl border border-emerald-100 bg-emerald-50 p-5">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-white text-emerald-800"><HomeIcon name="check" size={24}/></span>
              <span>
                <strong className="block text-base font-bold text-emerald-950">No issues flagged</strong>
                <span className="mt-1 block text-sm leading-6 text-emerald-900">Customer debts, stock counts and setup issues will appear here when recorded.</span>
              </span>
            </div>
          ) : (
            <div className="min-w-0 divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-[0_2px_8px_rgba(22,40,30,0.025)]">
              {snapshot.customers_owing > 0 && (
                <AttentionRow href="/customers" icon="people" title="Money customers owe"
                  description={`${snapshot.customers_owing} ${snapshot.customers_owing === 1 ? "customer owes" : "customers owe"} money`}
                  value={formatNaira(snapshot.outstanding)}/>
              )}
              {emptiesCustomers > 0 && (
                <AttentionRow href="/empties" icon="empties" title="Empties customers owe"
                  description="Crates and bottles still outstanding"
                  value={`${emptiesCustomers} ${emptiesCustomers === 1 ? "customer" : "customers"}`}/>
              )}
              {hasHeldEmpties && (
                <AttentionRow href="/empties" icon="warning" warm title="Different empties held"
                  description="Customers may still owe the correct types"
                  value={[heldCrates > 0 ? `${heldCrates} ${heldCrates === 1 ? "crate" : "crates"}` : "", heldBottles > 0 ? `${heldBottles} ${heldBottles === 1 ? "bottle" : "bottles"}` : ""].filter(Boolean).join(" · ")}/>
              )}
              {lowStockOnly > 0 && (
                <AttentionRow href="/stock" icon="box" title="Low stock" description="One crate or less remaining"
                  value={`${lowStockOnly} ${lowStockOnly === 1 ? "drink" : "drinks"}`}/>
              )}
              {snapshot.missing_counts > 0 && (
                <AttentionRow href="/stock/count" icon="count" title="Stock not counted"
                  description="Set what is physically in the depot" value={String(snapshot.missing_counts)}/>
              )}
              {drinksNeedingSetup > 0 && (
                <AttentionRow href="/products" icon="settings" title="Drinks need setup"
                  description="Add missing crate details before selling" value={String(drinksNeedingSetup)}/>
              )}
            </div>
          )}
        </section>
        </div>
      </div>

    </div>
  );
}
