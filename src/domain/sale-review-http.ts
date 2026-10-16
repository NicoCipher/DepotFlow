import type { SaleCatalog } from "./sale-builder.ts";

export type SaleReviewResult =
  | { catalog: SaleCatalog; amount: number }
  | { error: string; code: "session_expired" | "customer_invalid" | "debt_unavailable" | "network_error" };

/** A separate same-origin fetch: unlike Server Functions this can be
 * cancelled and is not serialized behind another client Server Function.
 * Authoritative validation remains in reviewSaleInputs on the server.
 */
export async function requestSaleReview(
  customerId: string,
  signal?: AbortSignal,
  transport: typeof fetch = fetch,
): Promise<SaleReviewResult> {
  const response = await transport("/api/sales/review", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customerId }),
    signal,
  });
  const data: unknown = await response.json();
  if (typeof data !== "object" || !data)
    throw new Error("Invalid review response.");
  if ("error" in data) {
    const error = typeof data.error === "string" ? data.error : "Could not check the sale. Try again.";
    const code = "code" in data && (
      data.code === "session_expired" || data.code === "customer_invalid" ||
      data.code === "debt_unavailable" || data.code === "network_error"
    ) ? data.code : response.status === 401 ? "session_expired" : "network_error";
    return { error, code };
  }
  if (!response.ok ||
      !("amount" in data) || typeof data.amount !== "number" ||
      !Number.isSafeInteger(data.amount) || data.amount < 0 ||
      !("catalog" in data) || typeof data.catalog !== "object" || !data.catalog ||
      !("products" in data.catalog) || !Array.isArray(data.catalog.products) ||
      !("customers" in data.catalog) || !Array.isArray(data.catalog.customers))
    throw new Error("Could not verify the sale. Try again.");
  return { catalog: data.catalog as SaleCatalog, amount: data.amount };
}
