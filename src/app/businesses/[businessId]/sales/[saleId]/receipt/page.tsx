import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/domain/ids";
import { formatNaira } from "@/domain/products";
import { formatBusinessDate, formatStoredQuantity } from "@/domain/sales";
import { methodLabel, receiptUrl } from "@/lib/receipts";
import { ShareReceipt } from "@/components/share-receipt";

type ReceiptBusiness = { name: string; address: string; phone: string };

export default async function BusinessSaleReceiptPage({
  params,
}: {
  params: Promise<{ businessId: string; saleId: string }>;
}) {
  const { businessId, saleId } = await params;
  if (!isUuid(businessId) || !isUuid(saleId)) notFound();

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/sign-in?next=%2Fbusinesses");

  const { data: businesses, error: listError } = await supabase.rpc("list_my_businesses_for_setup");
  if (listError || !businesses?.some((b) =>
    b.business_id === businessId && b.business_status === "active" && b.member_kind === "owner")) {
    notFound();
  }

  const { data: sale, error: saleError } = await supabase.from("sales")
    .select("id,business_id,customer_id,total_amount,paid_amount,business_date,created_at,payment_method,receipt_number,verification_token,receipt_status,receipt_business,receipt_customer_name")
    .eq("business_id", businessId)
    .eq("id", saleId)
    .maybeSingle();
  if (saleError) throw new Error("Could not load this depot's receipt.");
  if (!sale || sale.business_id !== businessId || !sale.receipt_number || !sale.verification_token) notFound();

  const { data: items, error: itemsError } = await supabase.from("sale_items")
    .select("id,product_name,total_bottles,bottles_per_crate,whole_crates,line_total")
    .eq("business_id", businessId)
    .eq("sale_id", saleId)
    .order("id");
  if (itemsError || !items) throw new Error("Could not load the saved sale details.");

  const business = sale.receipt_business as ReceiptBusiness | null;
  if (!business?.name) throw new Error("The saved depot receipt details are incomplete.");
  const url = receiptUrl(sale.verification_token);
  const qr = await QRCode.toDataURL(url, { width: 224, margin: 1, errorCorrectionLevel: "M" });
  const unpaid = sale.total_amount > sale.paid_amount;
  const collected = sale.paid_amount;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 pb-8">
      <nav className="flex items-center justify-between gap-3">
        <Link href={`/businesses/${businessId}/sales`} className="quiet-link">← Back to sales</Link>
        <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">Saved depot receipt</span>
      </nav>
      <ShareReceipt
        url={url}
        number={sale.receipt_number}
        qrDataUrl={qr}
        receipt={{
          businessName: business.name,
          businessAddress: business.address ?? "",
          businessPhone: business.phone ?? "",
          title: "Sale Receipt",
          customer: sale.receipt_customer_name,
          date: formatBusinessDate(sale.business_date ?? sale.created_at.slice(0, 10)),
          method: methodLabel(sale.payment_method),
          tenders: [],
          amount: formatNaira(collected),
          total: formatNaira(sale.total_amount),
          balanceLabel: "Balance on this sale",
          balance: formatNaira(sale.total_amount - sale.paid_amount),
          status: sale.receipt_status === "voided" ? "voided" : collected === 0 ? "unpaid" : unpaid ? "partial" : "paid",
          items: items.map((item) => ({
            name: item.product_name,
            quantity: formatStoredQuantity(item),
            amount: formatNaira(item.line_total),
          })),
        }}
      />
      <p className="text-xs leading-5 text-stone-500">
        This receipt uses the depot details and customer name saved when the sale was recorded. It does not read another depot's profile.
      </p>
    </div>
  );
}
