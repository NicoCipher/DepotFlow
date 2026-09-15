"use server";
import { requireOwner } from "@/lib/auth/owner";
import type {
  SaleCatalog,
  SaleCustomer,
  SaleProduct,
} from "@/domain/sale-builder";
// Read-only: this milestone never writes a sale or reserves stock.
export async function loadSaleCatalog(): Promise<SaleCatalog> {
  const supabase = await requireOwner();
  async function products() {
    const rows: SaleProduct[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("products")
        .select(
          "id,name,size,image_url,bottles_per_crate,full_crate_price,half_crate_price,quarter_crate_price,bottle_price,stock(total_bottles)",
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
