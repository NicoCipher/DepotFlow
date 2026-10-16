/** Verified full UUID shape for sale customer identifiers.
 * Shared by both the optional old-balance function and authoritative Review.
 * Never accept partial UUID patterns (8-4-4-12) as a customer identifier.
 */
export function validSaleReviewCustomerId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
