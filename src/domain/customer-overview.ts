/** The money, crate and bottle ledgers are independent: never offset one against another. */
export function sumOwed(rows: readonly { quantity: number }[]): number {
  return rows.reduce((total, row) => total + Math.max(0, row.quantity), 0);
}

export function owedByCustomer(
  rows: readonly { customer_id: string; quantity: number }[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.customer_id, (totals.get(row.customer_id) ?? 0) + Math.max(0, row.quantity));
  }
  return totals;
}

export function customerHasOutstanding(
  money: number,
  crates: number,
  bottles: number,
  held = 0,
): boolean {
  return money > 0 || crates > 0 || bottles > 0 || held > 0;
}
