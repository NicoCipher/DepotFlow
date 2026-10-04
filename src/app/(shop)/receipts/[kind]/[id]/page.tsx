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
        "id,customer_id,total_amount,paid_amount,business_date,created_at,payment_method,receipt_number,verification_token,receipt_status,receipt_business,receipt_customer_name,receipt_customer_name_source",
      )
      .eq("id", id)
      .maybeSingle();
    if (error) throw new Error("Could not load receipt.");
    if (data && data.paid_amount > 0)
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
        receipt_business: data.receipt_business as Business | null,
        receipt_customer_name: data.receipt_customer_name,
        receipt_customer_name_source: data.receipt_customer_name_source as
          | "captured"
          | "legacy_backfill",
      };
  }
  if (!receipt) notFound();
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
      <Link
        className="quiet-link self-start"
        href={
          kind === "sale" ? `/sales/${id}` : `/customers/${receipt.customer_id}`
        }
      >
        ← Back to {kind === "sale" ? "sale" : "customer"}
      </Link>
      {business ? (
        <section aria-label="Shop details" className="space-y-1">
          {business.logo_url && (
            <Image
              unoptimized
              src={business.logo_url}
              width={80}
              height={80}
              alt={`${business.name} logo`}
              className="mb-3 h-20 w-20 object-contain"
            />
          )}
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
            Business details were not set when this receipt was saved. Current
            shop details are not substituted into the receipt later.
          </p>
          <Link className="quiet-link mt-2 inline-block" href="/business">
            Set details for future receipts
          </Link>
        </section>
      )}
      <header>
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">
          Confirmed payment
        </p>
        <h1>{kind === "sale" ? "Sale Receipt" : "Balance Payment Receipt"}</h1>
        <p className="mt-1 text-stone-600">{receipt.receipt_number}</p>
      </header>
      {receipt.receipt_status === "voided" && (
        <p className="rounded-lg bg-red-50 p-3 font-semibold text-red-900">
          Voided receipt
        </p>
      )}
      <section
        className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
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
        {kind === "sale" && (
          <p className="mb-3 flex justify-between font-semibold">
            <span>Sale total</span>
            <span>{formatNaira(receipt.total ?? 0)}</span>
          </p>
        )}
        <p className="text-sm text-stone-600">Amount received</p>
        <p className="text-3xl font-bold text-emerald-950">
          {formatNaira(receipt.amount)}
        </p>
        {receipt.owed_after > 0 && (
          <p className="mt-2 inline-block rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-950">
            Partial payment
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
            [
              kind === "sale"
                ? "Unpaid on this sale"
                : "Customer balance after",
              formatNaira(receipt.owed_after),
            ],
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
      <section className="flex flex-col items-center rounded-2xl border border-stone-200 bg-white p-5 text-center">
        <h2 className="font-semibold">Verify this receipt</h2>
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
      </section>
      <ShareReceipt
        url={url}
        number={receipt.receipt_number}
        qrDataUrl={qr}
        receipt={{
          businessName: business?.name ?? "Business details not saved",
          businessAddress: business?.address ?? "",
          businessPhone: business?.phone ?? "",
          title:
            kind === "sale" ? "Sale Receipt" : "Balance Payment Receipt",
          customer: receipt.receipt_customer_name,
          date: formatBusinessDate(receipt.business_date),
          method: methodLabel(receipt.method),
          amount: formatNaira(receipt.amount),
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
              : receipt.owed_after > 0
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
    </div>
  );
}
