export type SaleSummary = {
  id: string;
  customerId: string;
  customerName: string;
  businessDate: string | null;
  createdAt: string;
  total: number;
  paid: number;
  owing: number;
  itemCount: number;
};

export type StoredSaleItem = {
  id: string;
  product_name: string;
  total_bottles: number;
  bottles_per_crate: number;
  line_total: number;
  bottles_returnable: boolean;
  crate_type: string | null;
  bottle_type: string | null;
  whole_crates: number;
  crates_returned: number;
  returnable_bottles_out: number | null;
  bottles_returned: number;
};

export type SaleItemHistory = {
  id: string;
  productName: string;
  quantity: string;
  lineTotal: number;
  crateType: string | null;
  cratesReturned: number;
  cratesOwed: number;
  bottlesReturnable: boolean;
  bottleType: string | null;
  bottlesReturned: number;
  bottlesOwed: number;
};

export const isSaleId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id,
  );

export function saleOwing(total: number, paid: number): number {
  return total - paid;
}

export function formatBusinessDate(value: string | null): string {
  if (!value) return "Date not recorded";
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function formatStoredQuantity(item: {
  total_bottles: number;
  bottles_per_crate: number;
  whole_crates: number;
}): string {
  const remainder =
    item.total_bottles - item.whole_crates * item.bottles_per_crate;
  const parts: string[] = [];
  if (item.whole_crates > 0) {
    parts.push(
      `${item.whole_crates} whole ${item.whole_crates === 1 ? "crate" : "crates"}`,
    );
  }
  if (remainder > 0 || item.whole_crates === 0) {
    parts.push(`${remainder} ${remainder === 1 ? "bottle" : "bottles"}`);
  }
  return parts.join(" + ");
}

export function storedSaleItemHistory(item: StoredSaleItem): SaleItemHistory {
  return {
    id: item.id,
    productName: item.product_name,
    quantity: formatStoredQuantity(item),
    lineTotal: item.line_total,
    crateType: item.crate_type,
    cratesReturned: item.crates_returned,
    cratesOwed: item.whole_crates - item.crates_returned,
    bottlesReturnable: item.bottles_returnable,
    bottleType: item.bottle_type,
    bottlesReturned: item.bottles_returned,
    bottlesOwed:
      (item.returnable_bottles_out ?? 0) - item.bottles_returned,
  };
}

export function newestSales(sales: SaleSummary[]): SaleSummary[] {
  return [...sales].sort((a, b) => {
    const date = (b.businessDate ?? "").localeCompare(a.businessDate ?? "");
    return (
      date ||
      b.createdAt.localeCompare(a.createdAt) ||
      b.id.localeCompare(a.id)
    );
  });
}

export function salesHistoryState(sales: SaleSummary[]) {
  return { empty: sales.length === 0, sales: newestSales(sales) };
}
