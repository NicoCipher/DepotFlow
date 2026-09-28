import { createClient } from "@/lib/supabase/server";
import { formatNaira } from "@/domain/products";
import { formatBusinessDate } from "@/domain/sales";
export const dynamic = "force-dynamic";
export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  type PublicReceipt = { number: string; amount: number; date: string; customer: string; status: string; kind: string };
  let result: PublicReceipt | null = null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    const db = await createClient();
    const { data, error } = await db.rpc("verify_receipt", { p_token: token });
    if (error) throw new Error("Verification is temporarily unavailable. Try again.");
    result = data as PublicReceipt | null;
  }
  return <div className="space-y-5"><header><p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">DepotFlow verification</p><h1>Check a Receipt</h1></header>
    {!result ? <section className="rounded-xl border border-stone-200 bg-white p-5"><h2 className="text-lg font-semibold">Receipt not found</h2><p className="mt-2 text-stone-600">Check the receipt number and scan the original code again.</p></section> : <section className="rounded-xl border border-stone-200 bg-white p-5"><p className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${result.status === "valid" ? "bg-emerald-100 text-emerald-900" : "bg-red-100 text-red-900"}`}>{result.status === "valid" ? "Valid saved receipt" : "Voided receipt"}</p><h2 className="mt-4 text-xl font-semibold">{result.number}</h2><dl className="mt-3 divide-y divide-stone-100">{[["Amount", formatNaira(result.amount)], ["Date", formatBusinessDate(result.date)], ["Customer", result.customer], ["Type", result.kind]].map(([label,value]) => <div key={label} className="flex justify-between gap-4 py-3"><dt className="text-stone-600">{label}</dt><dd className="font-semibold">{value}</dd></div>)}</dl><p className="mt-3 text-sm text-stone-600">Compare these details with the receipt you received. A QR code by itself does not prove a receipt is genuine.</p></section>}
  </div>;
}
