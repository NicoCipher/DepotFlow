export type ReceivingSnapshot = {
  stock: number;
  empties: number;
  bottlesPerCrate: number;
  crateType: string;
};
export type ReceivingState = {
  crates: string;
  businessDate: string;
  message?: string;
  review?: ReceivingSnapshot & {
    crates: number;
    businessDate: string;
    stockAfter: number;
    emptiesAfter: number;
  };
};
export function receivingPreview(raw: string, snapshot: ReceivingSnapshot) {
  const crates = Number(raw.trim());
  if (
    !/^\d+$/.test(raw.trim()) ||
    !Number.isSafeInteger(crates) ||
    crates <= 0 ||
    crates > 2147483647
  ) {
    throw new Error("Enter a positive whole number of crates.");
  }
  if (
    ![snapshot.stock, snapshot.empties].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) ||
    !Number.isSafeInteger(snapshot.bottlesPerCrate) ||
    snapshot.bottlesPerCrate <= 0
  )
    throw new Error("Stock details are not valid.");
  if (crates > snapshot.empties)
    throw new Error("Not enough empty crates of this type.");
  const stockAfter = snapshot.stock + crates * snapshot.bottlesPerCrate;
  if (!Number.isSafeInteger(stockAfter) || stockAfter > 2147483647)
    throw new Error("That would exceed the stock limit.");
  return {
    ...snapshot,
    crates,
    stockAfter,
    emptiesAfter: snapshot.empties - crates,
  };
}
