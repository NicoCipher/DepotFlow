import type { Database } from "../types/database";

type Rows = Database["public"]["Tables"];
export type Product = Rows["products"]["Row"];
export type Customer = Rows["customers"]["Row"];
export type Sale = Rows["sales"]["Row"];
export type SaleItem = Rows["sale_items"]["Row"];
export type Stock = Rows["stock"]["Row"];
export type MoneyOwed = Rows["money_owed"]["Row"];
export type Deposit = Rows["deposits"]["Row"];
export type CrateObligation = Rows["crate_obligations"]["Row"];
export type BottleObligation = Rows["bottle_obligations"]["Row"];
export type EmptyCrateStock = Rows["empty_crate_stock"]["Row"];
export type EmptyBottleStock = Rows["empty_bottle_stock"]["Row"];
