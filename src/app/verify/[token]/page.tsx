import { createClient } from "@/lib/supabase/server";
import { formatNaira } from "@/domain/products";
import { formatBusinessDate, formatStoredQuantity } from "@/domain/sales";
import { methodLabel } from "@/lib/receipts";
import { readAccountReceipt } from "@/domain/account-receipt";

export const dynamic = "force-dynamic";
export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

type PublicBusiness = {
  name?: string;
  address?: string;
  phone?: string;
};

type PublicReceiptItem = {
  name: string;
  total_bottles: number;
  bottles_per_crate: number;
  whole_crates: number;
  amount: number;
};

type PublicReceipt = {
  number: string;
  amount: number;
  date: string;
  customer: string;
  customer_snapshot_source?: "captured" | "legacy_backfill";
  status: string;
  kind: string;
  method?: string;
  total?: number | null;
  balance?: number;
  account?: unknown;
  business_snapshot?: boolean;
  business?: PublicBusiness | null;
  items?: PublicReceiptItem[];
};

export default async function VerifyPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  let result: PublicReceipt | null = null;

  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      token,
    )
  ) {
    const db = await createClient();
    const { data, error } = await db.rpc("verify_receipt", { p_token: token });
    if (error)
      throw new Error("Verification is temporarily unavailable. Try again.");
    result = data as PublicReceipt | null;
  }

  if (!result) {
    return (
      <div className="mx-auto w-full max-w-xl space-y-5">
        <header>
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
            DepotFlow verification
          </p>
          <h1>Check a Receipt</h1>
        </header>
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-lg font-semibold">Receipt not found</h2>
          <p className="mt-2 text-stone-600">
            Check the receipt link or scan the original code again.
          </p>
        </section>
      </div>
    );
  }

  const isSale = result.kind === "sale" || result.kind === "sale payment";
  const items = Array.isArray(result.items) ? result.items : [];
  const business = result.business ?? null;
  const hasBalance = typeof result.balance === "number";
  const legacyCustomer =
    result.customer_snapshot_source === "legacy_backfill";
  const hasBusinessSnapshot =
    result.business_snapshot ?? Boolean(business?.name);
  const account = isSale ? readAccountReceipt(result.account) : null;
  const amountCollected = account ? account.collected : result.amount;

  return (
    <div className="mx-auto w-full max-w-xl space-y-5">
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
          DepotFlow verification
        </p>
        <h1>{account ? "Sale & Customer Account Receipt" : isSale ? "Sale Receipt" : "Balance Payment Receipt"}</h1>
        <p className="mt-1 text-stone-600">{result.number}</p>
        {amountCollected === 0 && <p className="mt-1 text-sm font-semibold text-amber-900">Sale recorded · payment pending</p>}
      </header>

      {hasBusinessSnapshot && business?.name ? (
        <section aria-label="Business details" className="space-y-1">
          <h2 className="text-2xl font-bold">{business.name}</h2>
          {business.address && (
            <p className="whitespace-pre-line text-stone-700">
              {business.address}
            </p>
          )}
          {business.phone && <p>{business.phone}</p>}
        </section>
      ) : (
        <section className="rounded-xl border border-stone-200 bg-stone-50 p-4">
          <p className="font-semibold">Business details not saved</p>
          <p className="mt-1 text-sm text-stone-600">
            Business details were not set when this receipt was saved. DepotFlow
            does not replace them later with the shop&apos;s current details.
          </p>
        </section>
      )}

      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <p
          className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${
            result.status === "valid"
              ? "bg-emerald-100 text-emerald-900"
              : "bg-red-100 text-red-900"
          }`}
        >
          {result.status === "valid"
            ? "Valid saved receipt"
            : "Voided receipt"}
        </p>

        {isSale && items.length > 0 && (
          <ul className="mt-5 divide-y divide-stone-200">
            {items.map((item, index) => (
              <li
                key={`${item.name}-${index}`}
                className="flex justify-between gap-4 py-4"
              >
                <div className="min-w-0">
                  <p className="break-words font-semibold">{item.name}</p>
                  <p className="text-sm text-stone-600">
                    {formatStoredQuantity(item)}
                  </p>
                </div>
                <p className="shrink-0 font-semibold">
                  {formatNaira(item.amount)}
                </p>
              </li>
            ))}
          </ul>
        )}

        {isSale && typeof result.total === "number" && (
          <p className="mt-5 flex justify-between font-semibold">
            <span>Sale total</span>
            <span>{formatNaira(result.total)}</span>
          </p>
        )}

        {account ? (
          <section aria-label="Verified customer account movement" className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <h2 className="font-bold text-emerald-950">Customer account at this sale</h2>
            <dl className="mt-3 divide-y divide-emerald-100 text-sm">
              {[
                ["Previous balance (B/D)", formatNaira(account.bd)],
                ["Today's sale", formatNaira(account.saleTotal)],
                ["Total amount due", formatNaira(account.bd + account.saleTotal)],
                ["Paid toward old debt", "−" + formatNaira(account.paidOld)],
                ["Paid toward today's sale", "−" + formatNaira(account.paidSale)],
                ["Total collected now", formatNaira(account.collected)],
                ["Balance carried down (C/D)", formatNaira(account.cd)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 py-2">
                  <dt className="text-emerald-950">{label}</dt>
                  <dd className="font-semibold tabular-nums text-emerald-950">{value}</dd>
                </div>
              ))}
            </dl>
            {account.debtPaymentReference && (
              <p className="mt-2 text-xs text-emerald-900">Old-debt payment reference: {account.debtPaymentReference}</p>
            )}
            <p className="mt-2 text-xs text-emerald-900">Balances shown are frozen as of this transaction, not the customer's current balance.</p>
          </section>
        ) : (
          <div className="mt-5 rounded-xl bg-emerald-50 p-4">
            <p className="text-sm text-emerald-900">{result.amount === 0 ? "No payment recorded" : "Amount received"}</p>
            <p className="text-3xl font-bold text-emerald-950">
              {formatNaira(result.amount)}
            </p>
          </div>
        )}

        <dl className="mt-5 divide-y divide-stone-100">
          {[
            ["Customer", result.customer],
            ["Business date", formatBusinessDate(result.date)],
            [
              "Method",
              result.method ? methodLabel(result.method) : "Not recorded",
            ],
            ["Reference", result.number],
            ...(!account && hasBalance
              ? [
                  [
                    isSale ? "Balance on this sale" : "Customer balance after",
                    formatNaira(result.balance ?? 0),
                  ],
                ]
              : []),
          ].map(([label, value]) => (
            <div
              key={label}
              className="flex justify-between gap-4 py-3 text-sm"
            >
              <dt className="text-stone-600">{label}</dt>
              <dd className="max-w-[65%] break-words text-right font-semibold">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        {legacyCustomer && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
            This older receipt predates customer-name snapshots. The displayed
            name was frozen from the customer record during the upgrade and will
            no longer change if the customer is renamed.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p className="font-semibold text-emerald-950">
          Verified against DepotFlow&apos;s saved record
        </p>
        <p className="mt-1 text-sm text-emerald-900">
          Saved money, item, date, payment and status details are verified.
          Identity details marked as older snapshots are shown honestly rather
          than replaced with current records.
        </p>
      </section>
    </div>
  );
}
