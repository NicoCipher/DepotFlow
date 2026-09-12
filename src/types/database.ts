/** Initial migration contract. Monetary values are whole Nigerian naira. */
type Table<Row> = {
  Row: Row;
  // API writes are intentionally unavailable until atomic operations exist.
  Insert: never;
  Update: never;
  Relationships: [];
};
type CustomerAmount = { customer_id: string; amount: number };

export type Database = {
  public: {
    Tables: {
      products: Table<{
        id: string; name: string; size: string | null; image_url: string | null;
        bottles_per_crate: number; full_crate_price: number;
        half_crate_price: number | null; quarter_crate_price: number | null;
        bottle_price: number | null; bottles_returnable: boolean;
        empty_family: string | null; crate_type: string; bottle_type: string | null;
        created_at: string;
      }>;
      customers: Table<{ id: string; name: string; phone: string; created_at: string }>;
      sales: Table<{ id: string; customer_id: string; total_amount: number; paid_amount: number; created_at: string }>;
      sale_items: Table<{
        id: string; sale_id: string; product_id: string; product_name: string;
        total_bottles: number; bottles_per_crate: number; line_total: number;
        bottles_returnable: boolean; crate_type: string; bottle_type: string | null;
        crates_out: number; returnable_bottles_out: number;
      }>;
      stock: Table<{ product_id: string; total_bottles: number }>;
      money_owed: Table<CustomerAmount>;
      deposits: Table<CustomerAmount>;
      crate_obligations: Table<{ customer_id: string; crate_type: string; quantity: number }>;
      bottle_obligations: Table<{ customer_id: string; bottle_type: string; quantity: number }>;
      empty_crate_stock: Table<{ crate_type: string; quantity: number }>;
      empty_bottle_stock: Table<{ bottle_type: string; quantity: number }>;
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
