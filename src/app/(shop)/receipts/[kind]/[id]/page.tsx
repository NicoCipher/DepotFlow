import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import Image from "next/image";
import { requireOwner } from "@/lib/auth/owner";
import { formatNaira } from "@/domain/products";
import { formatBusinessDate, formatStoredQuantity } from "@/domain/sales";
import { methodLabel, receiptUrl } from "@/lib/receipts";
import { SuccessToast } from "@/components/success-toast";
import { ShareReceipt } from "@/components/share-receipt";
import { readAccountReceipt, type AccountReceipt } from "@/domain/account-receipt";

type Business = {
  name: string;
  address: string;
  phone: string;
  logo_url: string;
};
type Receipt = {
  id: string;
  customer_id: string;
  amount: number;
  business_date: string;
  created_at: string;
  method: string;
  owed_after: number;
  receipt_number: string;
  verification_token: string;
  receipt_status: string;
  kind: "payment" | "sale";
  total?: number;
  accountReceipt?: AccountReceipt | null;
  receipt_business?: Business | null;
  receipt_customer_name: string;
  receipt_customer_name_source: "captured" | "legacy_backfill";
};
export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ kind: string; id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { kind, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["payment", "sale"].includes(kind))
    notFound();
  const db = await requireOwner();
  let receipt: Receipt | null = null;
  if (kind === "payment") {
    const { data, error } = await db
      .from("customer_payments")
      .select(
        "id,customer_id,amount,business_date,created_at,method,owed_after,receipt_number,verification_token,receipt_status,receipt_business,receipt_customer_name,receipt_customer_name_source",
      )
      .or(`id.eq.${id},request_id.eq.${id}`)
      .maybeSingle();
    if (error) throw new Error("Could not load receipt.");
    if (data)
      receipt = {
        ...data,
        receipt_business: data.receipt_business as Business | null,
        receipt_customer_name_source: data.receipt_customer_name_source as
          | "captured"
          | "legacy_backfill",
        kind: "payment",
      };
  } else {
    const { data, error } = await db
      .from("sales")
      .select(
        "id,customer_id,total_amount,paid_amount,business_date,created_at,payment_method,receipt_number,verification_token,receipt_status,receipt_business,receipt_customer_name,receipt_customer_name_source,account_receipt",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error("Could not load receipt.");
    if (data)
      receipt = {
        id: data.id,
        customer_id: data.customer_id,
        amount: data.paid_amount,
        business_date: data.business_date ?? data.created_at.slice(0, 10),
        created_at: data.created_at,
        method: data.payment_method,
        owed_after: data.total_amount - data.paid_amount,
        receipt_number: data.receipt_number,
        verification_token: data.verification_token,
        receipt_status: data.receipt_status,
        kind: "sale",
        total: data.total_amount,
        accountReceipt: readAccountReceipt(data.account_receipt),
        receipt_business: data.receipt_business as Business | null,
        receipt_customer_name: data.receipt_customer_name,
        receipt_customer_name_source: data.receipt_customer_name_source as
          | "captured"
          | "legacy_backfill",
      };
  }
  if (!receipt) notFound();
  // The debt payment remains independently verifiable, but its parent
  // checkout is the owner's primary view of this single customer visit.
  const linkedCheckout = kind === "payment"
    ? await db.from("sales")
        .select("id")
        .eq("customer_id", receipt.customer_id)
        .contains("account_receipt", { debtPaymentReference: receipt.receipt_number })
        .maybeSingle()
    : null;
  if (linkedCheckout?.error) throw new Error("Could not load related checkout.");
  const parentSaleId = linkedCheckout?.data?.id ?? null;
  const itemsResult =
    kind === "sale"
      ? await db
          .from("sale_items")
          .select(
            "id,product_name,total_bottles,bottles_per_crate,whole_crates,line_total",
          )
          .eq("sale_id", receipt.id)
          .order("id")
      : { data: [], error: null };
  if (itemsResult.error) throw new Error("Could not load receipt details.");
  const business = receipt.receipt_business;
  const account = receipt.kind === "sale" ? receipt.accountReceipt ?? null : null;
  const accountUnpaid = account ? account.cd > 0 : receipt.owed_after > 0;
  const accountCollected = account ? account.collected : receipt.amount;
  const items = itemsResult.data ?? [];
  const url = receiptUrl(receipt.verification_token);
  const qr = await QRCode.toDataURL(url, {
    width: 224,
    margin: 1,
    errorCorrectionLevel: "M",
  });
  const { saved } = await searchParams;
  return (
    <div className="space-y-5">
      {saved === "1" && (
        <SuccessToast message="Payment saved. Receipt ready." />
      )}
      <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Receipt navigation">
        <Link className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-emerald-800" href="/records">
          <span aria-hidden="true">←</span> Records
        </Link>
        <Link className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800 underline underline-offset-4"
          href={kind === "sale" ? `/sales/${id}` : `/customers/${receipt.customer_id}`}>
          {kind === "sale" ? "Sale details" : "Customer account"} →
        </Link>
      </nav>
      <header className="overflow-hidden rounded-3xl bg-emerald-950 px-5 py-6 text-white shadow-[0_12px_35px_rgba(6,78,59,.13)] sm:px-7 sm:py-7">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-bold">
            {account ? "Sale & account receipt" : kind === "sale" ? "Sale receipt" : "Debt payment receipt"}
          </span>
          <span className="text-xs font-medium tracking-wide text-emerald-100">{receipt.receipt_number}</span>
        </div>
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
          {receipt.receipt_status === "voided" ? "Receipt voided" : kind === "sale" ? "Sale recorded" : "Payment received"}
        </h1>
        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-emerald-100">
          {kind === "sale" && !account ? "Sale value" : account ? "Total money collected" : "Amount received"}
        </p>
        <p className="mt-1 text-3xl font-extrabold tabular-nums text-white sm:text-4xl">
          {formatNaira(kind === "sale" && !account ? receipt.total ?? 0 : accountCollected)}
        </p>
        <p className="mt-3 break-words text-sm font-semibold text-emerald-50">{receipt.receipt_customer_name}</p>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-white/20 pt-4 text-xs text-emerald-100">
          <span>{formatBusinessDate(receipt.business_date)}</span>
          <span className={`rounded-full px-3 py-1 font-bold ${
            receipt.receipt_status === "voided" ? "bg-red-200 text-red-950" :
              accountUnpaid ? "bg-amber-100 text-amber-950" : "bg-white/15 text-white"
          }`}>
            {receipt.receipt_status === "voided" ? "Voided"
              : kind === "sale" && receipt.amount === 0 && (!account || account.collected === 0)
                ? "Payment pending"
                : accountUnpaid ? kind === "payment" ? "Customer still owes" : account ? "Customer balance outstanding" : "Partly paid" : kind === "payment" ? "Payment received" : "Paid in full"}
          </span>
        </div>
      </header>
      {receipt.receipt_status === "voided" && (
        <p role="status" className="rounded-xl border border-red-200 bg-red-50 p-4 font-semibold text-red-900">This receipt was voided. Do not treat it as a valid payment.</p>
      )}
      {parentSaleId && (
        <Link href={`/receipts/sale/${parentSaleId}`}
          className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-950">
          <span><strong className="block">Paid during a purchase</strong>
            <span className="mt-1 block font-normal text-emerald-900">See the sale, old debt paid and closing balance together.</span>
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      )}
      <section aria-label="Receipt sharing" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 sm:p-4">
      <ShareReceipt
        url={url}
        number={receipt.receipt_number}
        qrDataUrl={qr}
        receipt={{
          businessName: business?.name ?? "Business details not saved",
          businessAddress: business?.address ?? "",
          businessPhone: business?.phone ?? "",
          title:
            account ? "Sale & Customer Account Receipt"
              : kind === "sale" ? "Sale Receipt" : "Balance Payment Receipt",
          customer: receipt.receipt_customer_name,
          date: formatBusinessDate(receipt.business_date),
          method: methodLabel(receipt.method),
          amount: formatNaira(accountCollected),
          account: account ? {
            bd: formatNaira(account.bd),
            saleTotal: formatNaira(account.saleTotal),
            due: formatNaira(account.bd + account.saleTotal),
            paidOld: formatNaira(account.paidOld),
            paidSale: formatNaira(account.paidSale),
            collected: formatNaira(account.collected),
            cd: formatNaira(account.cd),
            debtPaymentReference: account.debtPaymentReference,
          } : undefined,
          total:
            kind === "sale" ? formatNaira(receipt.total ?? 0) : undefined,
          balanceLabel:
            kind === "sale"
              ? "Balance on this sale"
              : "Customer balance after",
          balance: formatNaira(receipt.owed_after),
          status:
            receipt.receipt_status === "voided"
              ? "voided"
              : accountCollected === 0
                ? "unpaid"
                : accountUnpaid
                  ? "partial"
                  : "paid",
          note:
            kind === "payment"
              ? "Payment towards money already owed."
              : undefined,
          items:
            kind === "sale"
              ? items.map((item) => ({
                  name: item.product_name,
                  quantity: formatStoredQuantity(item),
                  amount: formatNaira(item.line_total),
                }))
              : [],
        }}
      />
      </section>
      {business ? (
        <section aria-label="Shop details" className="flex flex-wrap items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-4 sm:px-5">
          {business.logo_url && (
            <Image
              unoptimized
              src={business.logo_url}
              width={56}
              height={56}
              alt={`${business.name} logo`}
              className="h-14 w-14 shrink-0 rounded-xl object-contain"
            />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="break-words font-bold text-stone-950">{business.name}</h2>
            {business.address && (
              <p className="mt-1 whitespace-pre-line break-words text-sm text-stone-600">
                {business.address}
              </p>
            )}
            {business.phone && <p className="mt-1 text-sm text-stone-600">{business.phone}</p>}
          </div>
        </section>
      ) : (
        <section className="rounded-xl border border-stone-200 bg-stone-50 p-4">
          <p className="font-semibold">Business details not saved</p>
          <p className="mt-1 text-sm text-stone-600">
            Business details were not set when this receipt was saved. Current
            shop details are not substituted into the receipt later.
          </p>
          <Link className="quiet-link mt-2 inline-block" href="/business">
            Set details for future receipts
          </Link>
        </section>
      )}

      <section
        className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6"
        aria-label="Receipt details"
      >
        {kind === "sale" ? (
          <ul className="mb-5 divide-y divide-stone-200">
            {items.map((item) => (
              <li key={item.id} className="flex justify-between gap-4 py-4">
                <div className="min-w-0">
                  <p className="break-words font-semibold">
                    {item.product_name}
                  </p>
                  <p className="text-sm text-stone-600">
                    {formatStoredQuantity(item)}
                  </p>
                </div>
                <p className="shrink-0 font-semibold">
                  {formatNaira(item.line_total)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-5 rounded-lg bg-stone-50 p-3">
            Payment towards money already owed. This receipt does not record a
            new sale.
          </p>
        )}
        {account ? (
          <section aria-label="Balance brought down and carried down" className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
            <h2 className="font-bold text-emerald-950">Customer account for this transaction</h2>
            <dl className="divide-y divide-emerald-100 text-sm">
              {[
                ["Previous balance (B/D)", formatNaira(account.bd)],
                ["Today's sale", formatNaira(account.saleTotal)],
                ["Total amount due", formatNaira(account.bd + account.saleTotal)],
                ["Paid toward previous debt", "−" + formatNaira(account.paidOld)],
                ["Paid toward today's sale", "−" + formatNaira(account.paidSale)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 py-2">
                  <dt className="text-emerald-950">{label}</dt>
                  <dd className="font-semibold tabular-nums text-emerald-950">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-emerald-200 pt-3">
              <span className="font-semibold text-emerald-950">Total collected now</span>
              <strong className="text-2xl font-bold tabular-nums text-emerald-950">{formatNaira(account.collected)}</strong>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-emerald-200 pt-3">
              <span className="font-bold text-emerald-950">Balance carried down (C/D)</span>
              <strong className="text-2xl font-bold tabular-nums text-emerald-950">{formatNaira(account.cd)}</strong>
            </div>
            <p className="text-xs text-emerald-900">
              B/D is what was owed before this sale. C/D is what remained immediately after this transaction.
            </p>
            {account.debtPaymentReference && (
              <p className="text-xs text-emerald-900">Old-debt payment reference: {account.debtPaymentReference}</p>
            )}
          </section>
        ) : (
          <>
            {kind === "sale" && (
              <p className="mb-3 flex justify-between font-semibold">
                <span>Sale total</span><span>{formatNaira(receipt.total ?? 0)}</span>
              </p>
            )}
            <p className="text-sm text-stone-600">{receipt.amount === 0 ? "No payment recorded" : "Amount received"}</p>
            <p className="text-3xl font-bold text-emerald-950">{formatNaira(receipt.amount)}</p>
          </>
        )}
        {accountUnpaid && (
          <p className="mt-3 inline-block rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-950">
            {accountCollected === 0 ? "Payment pending" : "Balance outstanding"}
          </p>
        )}
        <dl className="mt-5 divide-y divide-stone-100">
          {[
            [
              "Customer",
              `${receipt.receipt_customer_name} · ${receipt.customer_id.slice(-6)}`,
            ],
            ["Business date", formatBusinessDate(receipt.business_date)],
            ["Method", methodLabel(receipt.method)],
            ["Reference", receipt.receipt_number],
            [
              "Covers",
              kind === "sale"
                ? `Sale ${receipt.id.slice(0, 8)} · total ${formatNaira(receipt.total ?? 0)}`
                : "Outstanding customer balance",
            ],
            ...(account ? [] : [[
              kind === "sale" ? "Unpaid on this sale" : "Customer balance after",
              formatNaira(receipt.owed_after),
            ]]),
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
        {receipt.receipt_customer_name_source === "legacy_backfill" && (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">
            Older receipt: the customer name was frozen during the receipt
            history upgrade and will no longer change if the customer is renamed.
          </p>
        )}
      </section>
      <details className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 font-bold text-stone-900">Verify this receipt <span aria-hidden="true">⌄</span></summary>
        <div className="flex flex-col items-center pt-4 text-center">
        <p className="text-sm font-semibold text-stone-800">Scan the QR code or open the verification page</p>
        <p className="mt-1 text-sm text-stone-600">
          Scan the code to compare it with DepotFlow’s saved payment.
        </p>
        <Image
          unoptimized
          src={qr}
          width={224}
          height={224}
          alt="QR code linking to receipt verification"
          className="my-3"
        />
        <a href={url} className="quiet-link break-all">
          Open verification page
        </a>
        </div>
      </details>
    </div>
  );
}
