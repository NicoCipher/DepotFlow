import { NextResponse, type NextRequest } from "next/server";
import { reviewSaleInputs } from "@/app/(shop)/record-sale/actions";

export const dynamic = "force-dynamic";

// The review uses its own HTTP request so it cannot be queued behind stalled
// client-side Server Functions (such as a background catalogue refresh).
// The existing server review performs owner authentication and independently
// validates the catalogue, stock and previous customer balance.
function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" },
  });
}

export async function POST(request: NextRequest) {
  let customerId: unknown;
  try {
    const input: unknown = await request.json();
    if (typeof input !== "object" || input === null || !("customerId" in input))
      return noStore({ error: "Choose a customer first.", code: "customer_invalid" }, 400);
    customerId = input.customerId;
  } catch {
    return noStore({ error: "Check the selected customer and retry.", code: "customer_invalid" }, 400);
  }
  if (typeof customerId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId))
    return noStore({ error: "Choose a customer first.", code: "customer_invalid" }, 400);

  try {
    const result = await reviewSaleInputs(customerId);
    if ("error" in result)
      return noStore({
        error: result.error,
        code: result.code ?? "network_error",
      }, result.code === "session_expired" ? 401 : result.code === "customer_invalid" ? 400 : 503);
    return noStore({ catalog: result.catalog, amount: result.amount });
  } catch {
    return noStore({ error: "Could not check the sale. Try Review again.", code: "network_error" }, 503);
  }
}
