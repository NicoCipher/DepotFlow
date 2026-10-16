/** The Review request checks current customer data; it never saves a sale.
 *
 * A short, same-origin request header lets modern checkout send the exact
 * selected customer ID without depending on a request-body stream parser.
 * Older checkout clients remain supported through the JSON fallback.
 * The server still authenticates the owner before reading either input.
 */
export const saleReviewCustomerHeader = "x-depotflow-review-customer-id";

export function validSaleReviewCustomerId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
