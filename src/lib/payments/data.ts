import "server-only";
import { requireOwner } from "@/lib/auth/owner";
import { newestPayments, type PaymentSummary } from "@/domain/payments";

type PaymentRow = {
  id: string;
  customer_id: string;
  business_date: string;
  created_at: string;
  amount: number;
  owed_after: number;
};

function summary(row: PaymentRow): PaymentSummary {
  return {
    id: row.id,
    customerId: row.customer_id,
    businessDate: row.business_date,
    createdAt: row.created_at,
    amount: row.amount,
    owedAfter: row.owed_after,
  };
}

export async function getRecentCustomerPayments(
  supabase: Awaited<ReturnType<typeof requireOwner>>,
  customerId: string,
) {
  const { data, error } = await supabase
    .from("customer_payments")
    .select("id,customer_id,business_date,created_at,amount,owed_after")
    .eq("customer_id", customerId)
    .order("business_date", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(10);
  if (error) throw new Error("Could not load payment history.");
  return newestPayments((data as PaymentRow[]).map(summary));
}
