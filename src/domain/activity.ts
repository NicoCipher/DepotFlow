/** Give activity rows a safe, accurate label, even for legacy records with missing descriptions. */
export function activityEventLabel(kind: string, description?: string | null): string {
  if (kind === "sale") return "Sale";
  if (kind === "payment") return "Payment";
  if (kind === "opening") return "Opening balance";
  if (kind === "stock") {
    if (description?.startsWith("Received stock")) return "Stock received";
    if (description?.startsWith("Stock count")) return "Stock count";
    return "Stock activity";
  }
  if (kind === "empties") {
    if (description?.startsWith("Empty crate count")) return "Empty crate count";
    if (description?.startsWith("Empties returned")) return "Empties returned";
    return "Empties activity";
  }
  return "Activity";
}
