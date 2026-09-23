import "server-only";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth/owner";
import {
  isSaleId,
  newestSales,
  saleOwing,
  storedSaleItemHistory,
  type SaleSummary,
} from "@/domain/sales";

const summarySelect =
  "id,customer_id,business_date,created_at,total_amount,paid_amount,customer:customers(name),sale_items(count)";

type SummaryRow = {
  id: string;
  customer_id: string;
  business_date: string | null;
  created_at: string;
  total_amount: number;
  paid_amount: number;
  customer: { name: string } | null;
  sale_items: { count: number }[];
};

function summary(row: SummaryRow): SaleSummary {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer?.name ?? "Customer not available",
    businessDate: row.business_date,
    createdAt: row.created_at,
    total: row.total_amount,
    paid: row.paid_amount,
    owing: saleOwing(row.total_amount, row.paid_amount),
    itemCount: row.sale_items[0]?.count ?? 0,
  };
}

export async function getSalesPage(page: number) {
  const supabase = await requireOwner();
  const from = (page - 1) * 30;
  const { data, error, count } = await supabase
    .from("sales")
    .select(summarySelect, { count: "exact" })
    .order("business_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + 29);
  if (error) throw new Error("Could not load sales.");
  return {
    sales: newestSales((data as SummaryRow[]).map(summary)),
    count: count ?? 0,
  };
}

export async function getSale(id: string) {
  const supabase = await requireOwner();
  if (!isSaleId(id)) notFound();
  const { data, error } = await supabase
    .from("sales")
    .select(
      "id,customer_id,business_date,created_at,total_amount,paid_amount,customer:customers(name),sale_items(id,product_name,total_bottles,bottles_per_crate,line_total,bottles_returnable,crate_type,bottle_type,whole_crates,crates_returned,returnable_bottles_out,bottles_returned)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("Could not load sale.");
  if (!data) notFound();
  return {
    id: data.id,
    customerId: data.customer_id,
    customerName: data.customer?.name ?? "Customer not available",
    businessDate: data.business_date,
    createdAt: data.created_at,
    total: data.total_amount,
    paid: data.paid_amount,
    owing: saleOwing(data.total_amount, data.paid_amount),
    items: data.sale_items.map(storedSaleItemHistory),
  };
}

export async function getRecentCustomerSales(
  supabase: Awaited<ReturnType<typeof requireOwner>>,
  customerId: string,
) {
  const { data, error } = await supabase
    .from("sales")
    .select(summarySelect)
    .eq("customer_id", customerId)
    .order("business_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(5);
  if (error) throw new Error("Could not load customer sales.");
  return newestSales((data as SummaryRow[]).map(summary));
}
