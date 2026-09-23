"use server";
import { requireOwner } from "@/lib/auth/owner";
import type {
  SaleCatalog,
  SaleCustomer,
  SaleProduct,
} from "@/domain/sale-builder";
import { type SaleDraft } from "@/domain/sale-builder";
export async function loadSaleCatalog(): Promise<SaleCatalog> {
  const supabase = await requireOwner();
  async function products() {
    const rows: SaleProduct[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id,name,size,image_url,bottles_per_crate,full_crate_price,half_crate_price,quarter_crate_price,bottle_price,bottles_returnable,bottle_type,crate_type_id,crate_type:crate_types(name,is_legacy,pocket_count),stock(total_bottles)",
        )
        .order("name")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error("Could not load drinks and stock.");
      rows.push(
        ...data.map(({ stock, ...product }) => ({
          ...product,
          available: stock?.total_bottles ?? null,
        })),
      );
      if (data.length < 1000) return rows;
    }
  }
  async function customers() {
    const rows: SaleCustomer[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("customers")
        .select("id,name,phone")
        .order("name")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error("Could not load customers.");
      rows.push(...data);
      if (data.length < 1000) return rows;
    }
  }
  const [productRows, customerRows] = await Promise.all([
    products(),
    customers(),
  ]);
  return { products: productRows, customers: customerRows };
}

export async function saveSale(requestId: string, draft: SaleDraft) {
  const supabase = await requireOwner();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      requestId,
    ) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.businessDate) ||
    !/^\d+$/.test(draft.paid) ||
    !Number.isSafeInteger(Number(draft.paid))
  )
    return { error: "Check the sale date and amount paid." };
  try {
    const lines = draft.lines.map((line) => {
      if (!line.reviewExpected)
        throw new Error("Review current prices and stock before saving.");
      const dueCrates = line.quantity.crates;
      const dueBottles = line.reviewExpected.returnable
        ? dueCrates * line.reviewExpected.size +
          (line.quantity.fraction * line.reviewExpected.size) / 4 +
          line.quantity.bottles
        : 0;
      const entry = draft.returns[line.productId];
      const returnedCrates = draft.allEmpties
        ? dueCrates
        : Number(entry?.crates);
      const returnedBottles = draft.allEmpties
        ? dueBottles
        : Number(entry?.bottles);
      if (
        ![returnedCrates, returnedBottles].every(Number.isSafeInteger) ||
        returnedCrates < 0 ||
        returnedCrates > dueCrates ||
        returnedBottles < 0 ||
        returnedBottles > dueBottles
      )
        throw new Error("Check the returned empties.");
      return {
        productId: line.productId,
        quantity: line.quantity,
        returnedCrates,
        returnedBottles,
        expected: line.reviewExpected,
      };
    });
    const { data, error } = await supabase.rpc("save_sale", {
      p_request_id: requestId,
      p_customer_id: draft.customerId,
      p_business_date: draft.businessDate,
      p_paid: Number(draft.paid),
      p_lines: lines,
    });
    if (error)
      return {
        error:
          error.code === "22023"
            ? error.message
            : "Could not save sale. Review and try again.",
      };
    return {
      result: data as {
        id: string;
        total: number;
        paid: number;
        owing: number;
        customer: string;
      },
    };
  } catch (cause) {
    return {
      error:
        cause instanceof Error
          ? cause.message
          : "Could not save sale. Review and try again.",
    };
  }
}
