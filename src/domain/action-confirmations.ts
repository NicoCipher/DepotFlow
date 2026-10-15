/** Input fingerprints for one deliberate confirmation before consequential writes.
 * These are UI safety checks, never authorization or accounting validation.
 */
export function paymentConfirmationKey(input: {
  request: string;
  customer: string;
  amount: string;
  businessDate: string;
  method: string;
  owed: number;
}): string {
  return JSON.stringify([
    input.request, input.customer, input.amount,
    input.businessDate, input.method, input.owed,
  ]);
}

export function emptyReturnConfirmationKey(input: {
  request: string;
  customer: string;
  counts: Record<string, string>;
  released: string[];
}): string {
  return JSON.stringify([
    input.request, input.customer,
    Object.entries(input.counts).sort(([a], [b]) => a.localeCompare(b)),
    [...input.released].sort(),
  ]);
}
