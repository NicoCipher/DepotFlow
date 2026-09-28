import Link from "next/link";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import Image from "next/image";
import { requireOwner } from "@/lib/auth/owner";
import { formatNaira } from "@/domain/products";
import { formatBusinessDate } from "@/domain/sales";
import { methodLabel, receiptUrl } from "@/lib/receipts";
import { SuccessToast } from "@/components/success-toast";
import { ShareReceipt } from "@/components/share-receipt";

type Receipt = { id: string; customer_id: string; amount: number; business_date: string; created_at: string; method: string; owed_after: number; receipt_number: string; verification_token: string; receipt_status: string; kind: "payment" | "sale"; total?: number };
export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ kind: string; id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { kind, id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !["payment", "sale"].includes(kind)) notFound();
  const db = await requireOwner();
  let receipt: Receipt | null = null;
  if (kind === "payment") {
    const { data, error } = await db.from("customer_payments").select("id,customer_id,amount,business_date,created_at,method,owed_after,receipt_number,verification_token,receipt_status").or(`id.eq.${id},request_id.eq.${id}`).maybeSingle();
    if (error) throw new Error("Could not load receipt.");
    if (data) receipt = { ...data, kind: "payment" };
  } else {
    const { data, error } = await db.from("sales").select("id,customer_id,total_amount,paid_amount,business_date,created_at,payment_method,receipt_number,verification_token,receipt_status").eq("id", id).maybeSingle();
    if (error) throw new Error("Could not load receipt.");
    if (data && data.paid_amount > 0) receipt = { id: data.id, customer_id: data.customer_id, amount: data.paid_amount, business_date: data.business_date ?? data.created_at.slice(0,10), created_at: data.created_at, method: data.payment_method, owed_after: data.total_amount - data.paid_amount, receipt_number: data.receipt_number, verification_token: data.verification_token, receipt_status: data.receipt_status, kind: "sale", total: data.total_amount };
  }
  if (!receipt) notFound();
  const customer = await db.from("customers").select("name").eq("id", receipt.customer_id).single();
  if (customer.error) throw new Error("Could not load receipt customer.");
  const url = receiptUrl(receipt.verification_token);
  const qr = await QRCode.toDataURL(url, { width: 224, margin: 1, errorCorrectionLevel: "M" });
  const { saved } = await searchParams;
  return <div className="space-y-5">
    {saved === "1" && <SuccessToast message="Payment saved. Receipt ready." />}
    <Link className="quiet-link self-start" href={kind === "sale" ? `/sales/${id}` : `/customers/${receipt.customer_id}`}>← Back to {kind === "sale" ? "sale" : "customer"}</Link>
    <header><p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Confirmed payment</p><h1>Payment Receipt</h1><p className="mt-1 text-stone-600">{receipt.receipt_number}</p></header>
    {receipt.receipt_status === "voided" && <p className="rounded-lg bg-red-50 p-3 font-semibold text-red-900">Voided receipt</p>}
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm" aria-label="Receipt details">
      <p className="text-sm text-stone-600">Amount received</p><p className="text-3xl font-bold text-emerald-950">{formatNaira(receipt.amount)}</p>
      {receipt.owed_after > 0 && <p className="mt-2 inline-block rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-950">Partial payment</p>}
      <dl className="mt-5 divide-y divide-stone-100">
        {[["Customer", `${customer.data.name} · ${receipt.customer_id.slice(-6)}`], ["Business date", formatBusinessDate(receipt.business_date)], ["Method", methodLabel(receipt.method)], ["Reference", receipt.receipt_number], ["Covers", kind === "sale" ? `Sale ${receipt.id.slice(0,8)} · total ${formatNaira(receipt.total ?? 0)}` : "Outstanding customer balance"], [kind === "sale" ? "Unpaid on this sale" : "Customer balance after", formatNaira(receipt.owed_after)]].map(([label,value]) => <div key={label} className="flex justify-between gap-4 py-3 text-sm"><dt className="text-stone-600">{label}</dt><dd className="max-w-[65%] break-words text-right font-semibold">{value}</dd></div>)}
      </dl>
    </section>
    <section className="flex flex-col items-center rounded-2xl border border-stone-200 bg-white p-5 text-center"><h2 className="font-semibold">Verify this receipt</h2><p className="mt-1 text-sm text-stone-600">Scan the code to compare it with DepotFlow’s saved payment.</p><Image unoptimized src={qr} width={224} height={224} alt="QR code linking to receipt verification" className="my-3" /><a href={url} className="quiet-link break-all">Open verification page</a></section>
    <ShareReceipt url={url} number={receipt.receipt_number} summary={`DepotFlow receipt ${receipt.receipt_number} · ${customer.data.name} · ${formatNaira(receipt.amount)} · ${formatBusinessDate(receipt.business_date)} · ${methodLabel(receipt.method)} · ${kind === "sale" ? "Sale payment" : "Customer balance payment"} · ${receipt.owed_after > 0 ? "Partial payment" : "Paid in full"} · Balance ${formatNaira(receipt.owed_after)}`} />
  </div>;
}
