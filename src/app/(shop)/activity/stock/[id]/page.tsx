import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { formatBusinessDate } from "@/domain/sales";
export default async function StockActivity({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await requireOwner();
  const { data, error } = await db.from("stock_movements").select("product_id,product_name,movement_type,quantity_change,resulting_stock,business_date,crates,loose_bottles").eq("id",id).maybeSingle();
  if (error) throw new Error("Could not load stock change.");
  if (!data) notFound();
  return <div className="space-y-5"><Link href="/activity" className="quiet-link">← Activity</Link><header><p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Stock activity</p><h1>{data.movement_type === "receive" ? "Stock Received" : "Stock Count"}</h1><p className="mt-2 text-xl font-semibold">{data.product_name}</p></header><dl className="review-list"><div><dt>Date</dt><dd>{formatBusinessDate(data.business_date)}</dd></div><div><dt>Change</dt><dd>{data.quantity_change > 0 ? "+" : ""}{data.quantity_change} bottles</dd></div><div><dt>Stock after</dt><dd>{data.resulting_stock} bottles</dd></div><div><dt>Counted quantity</dt><dd>{data.crates} crates, {data.loose_bottles} loose bottles</dd></div></dl><Link className="secondary w-full" href="/stock">View Stock</Link></div>;
}
