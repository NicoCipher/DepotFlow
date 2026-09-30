import type { Database } from "../types/database";

type Rows = Database["public"]["Tables"];
export type Product = Rows["products"]["Row"];
export type Customer = Rows["customers"]["Row"];
export type Sale = Rows["sales"]["Row"];
export type Stock = Rows["stock"]["Row"];
export type Deposit = Rows["deposits"]["Row"];
