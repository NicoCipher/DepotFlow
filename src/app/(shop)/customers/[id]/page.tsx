import Link from "next/link";
import { releaseHeldEmpties } from "./held-actions";
import { SuccessToast } from "@/components/success-toast";
import { CustomerIcon } from "@/components/customer-icon";
import { getCustomer } from "@/lib/customers/data";
import { formatNaira } from "@/domain/products";
import { formatBusinessDate } from "@/domain/sales";
import { activityEventLabel } from "@/domain/activity";
import { customerHasOutstanding, sumOwed } from "@/domain/customer-overview";

type CustomerActivity = {
  id: string;
  day: string;
  created_at: string;
  kind: string;
  title: string | null;
  description: string | null;
  detail: string;
  sale_value: number;
  received: number;
};
type ActivityFeed = { count: number; items: CustomerActivity[] };

const successMessages: Record<string, string> = {
  added: "Customer added.",
  updated: "Customer updated.",
  payment: "Payment recorded.",
  empties: "Empty return recorded. Balances updated.",
  archived: "Customer archived.",
  restored: "Customer restored.",
};

function activityTime(date: string) {
  return new Intl.DateTimeFormat("en-NG", {
    timeZone: "Africa/Lagos", hour: "numeric", minute: "2-digit",
  }).format(new Date(date));
}

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { customer, supabase } = await getCustomer(id);
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const [money, crates, bottles, deposits, held, activity] = await Promise.all([
    supabase.from("money_owed").select("amount").eq("customer_id", id).maybeSingle(),
    supabase.from("crate_obligations").select("crate_type_id,crate_type,quantity")
      .eq("customer_id", id).gt("quantity", 0).order("crate_type_id"),
    supabase.from("bottle_obligations").select("bottle_type,quantity")
      .eq("customer_id", id).gt("quantity", 0).order("bottle_type"),
    supabase.from("deposits").select("amount").eq("customer_id", id).maybeSingle(),
    supabase.from("sale_empty_decisions")
      .select("id,product_name,kind,returned_name,owed_name,quantity,sale_id")
      .eq("customer_id", id).eq("decision", "hold").is("released_at", null).order("id"),
    // Owner-scoped recent-only RPC: six items, without whole-history totals.
    supabase.rpc("customer_recent_activity", { p_customer: id }),
  ]);
  if ([money, crates, bottles, deposits, held, activity].some((result) => result.error))
    throw new Error("Could not load the customer account.");

  const crateRows = crates.data ?? [];
  const bottleRows = bottles.data ?? [];
  const heldRows = held.data ?? [];
  const moneyOwed = money.data?.amount ?? 0;
  const crateCount = sumOwed(crateRows);
  const bottleCount = sumOwed(bottleRows);
  const hasEmpties = crateCount > 0 || bottleCount > 0;
  const attentionNeeded = customerHasOutstanding(moneyOwed, crateCount, bottleCount, heldRows.length);
  const archived = Boolean(customer.archived_at);
  const depositHeld = deposits.data?.amount ?? 0;
  const feed = activity.data as ActivityFeed | null;
  if (!feed || !Array.isArray(feed.items)) throw new Error("Could not load customer activity.");

  const crateIds = [...new Set(crateRows.map((row) => row.crate_type_id).filter(Boolean))];
  const crateTypeNames = new Map<string, string>();
  if (crateIds.length) {
    const types = await supabase.from("crate_types").select("id,name").in("id", crateIds);
    if (types.error) throw new Error("Could not load crate type names.");
    for (const type of types.data ?? []) crateTypeNames.set(type.id, type.name);
  }

  const { saved } = await searchParams;
  const success = saved ? successMessages[saved] : undefined;
  const contactPhone = customer.phone.replace(/[^+0-9]/g, "");
  const activityLink = "/activity?customer=" + encodeURIComponent(id);

  return (
    <div className="pb-8">
      {success && <SuccessToast message={success} />}
      <Link className="quiet-link inline-flex min-h-11 items-center text-sm" href="/customers">
        ← All customers
      </Link>

      <header className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-emerald-800">
            Customer account
          </p>
          <h1 className="break-words text-3xl font-bold tracking-tight sm:text-4xl">{customer.name}</h1>
          {customer.business_name && (
            <p className="mt-1 break-words text-stone-600">{customer.business_name}</p>
          )}
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-stone-700">
            <CustomerIcon name="phone" className="h-4 w-4 text-stone-500" />
            {customer.phone}
            {archived && (
              <span className="rounded-full bg-stone-200 px-2 py-1 text-xs font-semibold text-stone-800">Archived</span>
            )}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <a href={"tel:" + contactPhone}
            className="secondary inline-flex min-h-11 flex-1 items-center justify-center gap-2 sm:flex-none">
            <CustomerIcon name="phone" className="h-4 w-4" /> Call
          </a>
          <Link href={"/customers/" + id + "/edit"}
            className="secondary inline-flex min-h-11 flex-1 items-center justify-center sm:flex-none">
            Manage
          </Link>
        </div>
      </header>

      <section aria-labelledby="customer-balances" className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 id="customer-balances" className="text-xl font-semibold">Current balances</h2>
          <span className={"rounded-full px-3 py-1 text-xs font-semibold " +
            (attentionNeeded ? "bg-amber-100 text-amber-950" : "bg-emerald-100 text-emerald-900")}>
            {attentionNeeded ? "Needs attention" : "Nothing owed"}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className={"rounded-2xl border p-5 " + (moneyOwed > 0 ? "border-amber-200 bg-amber-50" : "border-stone-200 bg-white")}>
            <div className="flex items-center gap-2 text-sm font-semibold text-stone-700">
              <CustomerIcon name="money" className="h-5 w-5 text-amber-900" />
              Money owed
            </div>
            <p className="mt-2 break-words text-3xl font-bold tracking-tight tabular-nums text-stone-950">{formatNaira(moneyOwed)}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-stone-700">
              <CustomerIcon name="crate" className="h-5 w-5 text-emerald-800" />
              Empty crates owed
            </div>
            <p className="mt-2 text-3xl font-bold tabular-nums">{crateCount}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-stone-700">
              <CustomerIcon name="bottle" className="h-5 w-5 text-emerald-800" />
              Empty bottles owed
            </div>
            <p className="mt-2 text-3xl font-bold tabular-nums">{bottleCount}</p>
          </div>
        </div>
        <p className="mt-2 px-1 text-sm text-stone-600">
          Deposit held: <strong className="text-stone-900">{formatNaira(depositHeld)}</strong>
          <span className="ml-1">· Kept separate from money owed.</span>
        </p>
      </section>

      <section aria-labelledby="customer-next-steps" className="mt-7 rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
        <h2 id="customer-next-steps" className="text-xl font-semibold">
          {archived ? "Customer archived" : "What to do next"}
        </h2>
        {archived ? (
          <p className="mt-2 text-sm leading-6 text-stone-600">
            This account is archived. You can still review its balances and history. Use Manage to restore the customer before recording new activity.
          </p>
        ) : attentionNeeded ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {moneyOwed > 0 && (
              <Link href={"/customers/" + id + "/pay"}
                className="group flex min-h-20 items-center gap-3 rounded-xl border border-emerald-900 bg-emerald-900 p-4 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-900">
                <CustomerIcon name="money" className="h-6 w-6 shrink-0" />
                <span className="min-w-0 flex-1">
                  <strong className="block">Record payment</strong>
                  <span className="mt-1 block text-sm text-emerald-100">{formatNaira(moneyOwed)} still owed</span>
                </span>
                <CustomerIcon name="arrow" className="h-5 w-5 shrink-0" />
              </Link>
            )}
            {hasEmpties && (
              <Link href={"/customers/" + id + "/return-empties"}
                className="flex min-h-20 items-center gap-3 rounded-xl border border-stone-300 bg-stone-50 p-4 text-emerald-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-900">
                <CustomerIcon name="return" className="h-6 w-6 shrink-0" />
                <span className="min-w-0 flex-1">
                  <strong className="block">Record empty returns</strong>
                  <span className="mt-1 block text-sm text-stone-600">{crateCount} {crateCount === 1 ? "empty crate" : "empty crates"} · {bottleCount} {bottleCount === 1 ? "empty bottle" : "empty bottles"} owed</span>
                </span>
                <CustomerIcon name="arrow" className="h-5 w-5 shrink-0" />
              </Link>
            )}
            {heldRows.length > 0 && (
              <a href="#held-empties"
                className="flex min-h-20 items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-900">
                <CustomerIcon name="bottle" className="h-6 w-6 shrink-0" />
                <span className="min-w-0 flex-1">
                  <strong className="block">Check different empties held here</strong>
                  <span className="mt-1 block text-sm">{heldRows.length} {heldRows.length === 1 ? "held entry" : "held entries"} to resolve</span>
                </span>
                <CustomerIcon name="arrow" className="h-5 w-5 shrink-0" />
              </a>
            )}
          </div>
        ) : (
          <div className="mt-4 flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-950">
            <CustomerIcon name="check" className="h-6 w-6 shrink-0" />
            <p className="text-sm leading-6">No money, empty crates or empty bottles currently owed. Nothing to collect right now.</p>
          </div>
        )}
      </section>

      <div className="mt-8 grid items-start gap-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.85fr)]">
        <section aria-labelledby="customer-activity" className="min-w-0">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="customer-activity" className="text-xl font-semibold">Recent activity</h2>
              <p className="mt-1 text-sm text-stone-600">Sales, payments and returned empties, newest first.</p>
            </div>
            <Link href={activityLink} className="quiet-link text-sm">
              View full history →
            </Link>
          </div>
          {feed.items.length === 0 ? (
            <div className="rounded-2xl border border-stone-200 bg-white p-6">
              <CustomerIcon name="history" className="h-7 w-7 text-stone-400" />
              <p className="mt-3 font-semibold">No activity recorded yet</p>
              <p className="mt-1 text-sm text-stone-600">Saved sales, payments and empties returns will appear here.</p>
            </div>
          ) : (
            <ol className="divide-y divide-stone-100 overflow-hidden rounded-2xl border border-stone-200 bg-white">
              {feed.items.map((item) => (
                <li key={item.kind + "-" + item.id}>
                  <Link href={item.detail}
                    className="group flex min-h-20 items-start gap-3 px-4 py-4 hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-emerald-800">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-900">
                      <CustomerIcon
                        name={item.kind === "payment" ? "money" : item.kind === "empties" ? "return" : "history"}
                        className="h-5 w-5"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-emerald-900">
                        {activityEventLabel(item.kind, item.description)}
                      </span>
                      <strong className="mt-1 block break-words text-sm text-stone-950">
                        {item.title?.trim() || activityEventLabel(item.kind, item.description)}
                      </strong>
                      <span className="mt-1 block text-xs text-stone-500">
                        <time dateTime={item.day}>{item.day === today ? "Today" : formatBusinessDate(item.day)}</time>
                        {" · "}
                        <time dateTime={item.created_at}>{activityTime(item.created_at)}</time>
                      </span>
                      {item.kind === "sale" && item.sale_value > 0 && (
                        <span className="mt-1 block text-xs text-stone-600">Sale total {formatNaira(item.sale_value)}</span>
                      )}
                      {item.received > 0 && (
                        <span className="mt-1 block text-sm font-semibold text-emerald-900">
                          Received {formatNaira(item.received)}
                        </span>
                      )}
                    </span>
                    <CustomerIcon name="arrow" className="mt-2 h-5 w-5 shrink-0 text-emerald-900" />
                  </Link>
                </li>
              ))}
            </ol>
          )}
          {feed.items.length > 0 && (
            <Link href={activityLink} className="secondary mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2">
              <CustomerIcon name="history" className="h-4 w-4" />
              See all customer activity
            </Link>
          )}
        </section>

        <div className="min-w-0 space-y-4">
          <section aria-labelledby="empties-detail" className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
            <h2 id="empties-detail" className="text-lg font-semibold">Empty crates and empty bottles still owed</h2>
            <p className="mt-1 text-sm text-stone-600">Keep each empty crate and empty bottle type separate when recording a return.</p>
            {crateRows.length === 0 && bottleRows.length === 0 ? (
              <p className="mt-4 flex items-center gap-2 text-sm font-medium text-emerald-900">
                <CustomerIcon name="check" className="h-5 w-5" /> No empty crates or empty bottles owed
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {crateRows.length > 0 && (
                  <details className="group rounded-xl border border-stone-200">
                    <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 px-3 py-3 font-semibold">
                      <span>{crateCount} {crateCount === 1 ? "empty crate" : "empty crates"} · See types</span>
                      <span aria-hidden="true" className="text-lg text-stone-500 group-open:rotate-45">+</span>
                    </summary>
                    <dl className="divide-y divide-stone-100 border-t border-stone-100 px-3">
                      {crateRows.map((crate) => (
                        <div key={crate.crate_type_id} className="flex justify-between gap-3 py-3 text-sm">
                          <dt className="min-w-0 break-words text-stone-700">
                            {crate.crate_type ?? crateTypeNames.get(crate.crate_type_id) ?? "Unknown crate type"}
                          </dt>
                          <dd className="shrink-0 font-semibold tabular-nums">{crate.quantity}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
                {bottleRows.length > 0 && (
                  <details className="group rounded-xl border border-stone-200">
                    <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-2 px-3 py-3 font-semibold">
                      <span>{bottleCount} {bottleCount === 1 ? "empty bottle" : "empty bottles"} · See types</span>
                      <span aria-hidden="true" className="text-lg text-stone-500 group-open:rotate-45">+</span>
                    </summary>
                    <dl className="divide-y divide-stone-100 border-t border-stone-100 px-3">
                      {bottleRows.map((bottle) => (
                        <div key={bottle.bottle_type} className="flex justify-between gap-3 py-3 text-sm">
                          <dt className="min-w-0 break-words text-stone-700">{bottle.bottle_type}</dt>
                          <dd className="shrink-0 font-semibold tabular-nums">{bottle.quantity}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                )}
                <p className="text-xs leading-5 text-stone-500">Crates and bottles are tracked separately. Different types are not automatically exchanged.</p>
              </div>
            )}
          </section>

          {heldRows.length > 0 && (
            <section id="held-empties" aria-labelledby="held-heading"
              className="scroll-mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
              <h2 id="held-heading" className="text-lg font-semibold text-amber-950">Wrong empties held here</h2>
              <p className="mt-2 text-sm leading-6 text-amber-950">
                These are held for this customer, not counted as usable empty stock. The correct type is still owed.
              </p>
              <ul className="mt-3 divide-y divide-amber-200">
                {heldRows.map((item) => (
                  <li key={item.id} className="py-4">
                    <p className="font-semibold text-amber-950">
                      {item.quantity} {item.returned_name} · {item.kind === "crate" ? "crates" : "bottles"}
                    </p>
                    <p className="mt-1 text-sm text-stone-700">
                      For {item.product_name} · {item.owed_name} still owed
                    </p>
                    <Link href={"/sales/" + item.sale_id} className="quiet-link mt-2 inline-flex text-sm">View original sale</Link>
                    {!archived && (
                      <form action={releaseHeldEmpties} className="mt-3">
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="customer" value={id} />
                        <button className="secondary min-h-11 w-full">Customer collected these empties</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {customer.address && (
            <details className="group rounded-2xl border border-stone-200 bg-white px-4 py-2">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between font-semibold">
                Address
                <span className="text-lg text-stone-500 group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="pb-3 whitespace-pre-line break-words text-sm text-stone-700">{customer.address}</p>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
