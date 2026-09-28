import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import { formatBusinessDate } from "@/domain/sales";
export default async function EmptiesActivity({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await requireOwner();
  const { data, error } = await db.from("empty_crate_movements").select("crate_type,previous_quantity,quantity_change,resulting_quantity,business_date").eq("id",id).maybeSingle();
  if (error) throw new Error("Could not load empty crate change.");
  if (!data) notFound();
  return <div className="space-y-5"><Link href="/activity" className="quiet-link">← Activity</Link><header><p className="text-sm font-semibold uppercase tracking-wide text-emerald-800">Empty crates activity</p><h1>Empty Crate Count</h1><p className="mt-2 text-xl font-semibold">{data.crate_type}</p></header><dl className="review-list"><div><dt>Date</dt><dd>{formatBusinessDate(data.business_date)}</dd></div><div><dt>Before</dt><dd>{data.previous_quantity ?? "Not recorded"}</dd></div><div><dt>Change</dt><dd>{data.quantity_change > 0 ? "+" : ""}{data.quantity_change}</dd></div><div><dt>Now</dt><dd>{data.resulting_quantity}</dd></div></dl><Link className="secondary w-full" href="/empty-crates">View Empty Crates</Link></div>;
}
