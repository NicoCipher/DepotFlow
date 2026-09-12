/** Every product supplies its own crate size. All results are whole bottles. */
function whole(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

function crateSize(bottlesPerCrate: number): void {
  whole(bottlesPerCrate, "Bottles per crate");
  if (bottlesPerCrate === 0) throw new RangeError("A crate must contain bottles.");
}

export function toBottles(crates: number, bottlesPerCrate: number, bottles = 0): number {
  crateSize(bottlesPerCrate);
  whole(bottles, "Loose bottles");
  if (!Number.isFinite(crates) || crates < 0) throw new RangeError("Crates must be non-negative.");
  const fromCrates = crates * bottlesPerCrate;
  whole(fromCrates, "Crate quantity in bottles");
  const total = fromCrates + bottles;
  whole(total, "Total bottles");
  return total;
}

export function splitBottles(totalBottles: number, bottlesPerCrate: number) {
  whole(totalBottles, "Total bottles");
  crateSize(bottlesPerCrate);
  return { crates: Math.floor(totalBottles / bottlesPerCrate), bottles: totalBottles % bottlesPerCrate };
}

export function formatQuantity(totalBottles: number, bottlesPerCrate: number): string {
  const { crates, bottles } = splitBottles(totalBottles, bottlesPerCrate);
  const parts: string[] = [];
  if (crates) parts.push(`${crates} ${crates === 1 ? "crate" : "crates"}`);
  if (bottles || !crates) parts.push(`${bottles} ${bottles === 1 ? "bottle" : "bottles"}`);
  return parts.join(" + ");
}

export function validateStock(requestedBottles: number, availableBottles: number):
  { valid: true } | { valid: false; message: string } {
  whole(requestedBottles, "Requested bottles");
  whole(availableBottles, "Available bottles");
  if (requestedBottles === 0) return { valid: false, message: "Choose at least one bottle." };
  if (availableBottles === 0) return { valid: false, message: "Out of stock" };
  if (requestedBottles > availableBottles) return { valid: false, message: "That is all that is in stock." };
  return { valid: true };
}
