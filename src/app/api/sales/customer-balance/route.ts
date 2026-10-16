import { NextResponse, type NextRequest } from "next/server";
import { ownerSession } from "@/lib/auth/owner";

export const dynamic = "force-dynamic";

// A normal HTTP request is independently cancellable/retryable; client-side
// Next Server Functions are serialized and cannot recover from a hung read.
function noStore(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" },
  });
}

export async function POST(request: NextRequest) {
  let customerId: unknown;
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("customerId" in body))
      return noStore({ error: "Choose a customer first." }, 400);
    customerId = body.customerId;
  } catch {
    return noStore({ error: "Check the customer and try again." }, 400);
  }
  if (typeof customerId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId))
    return noStore({ error: "Choose a customer first." }, 400);

  try {
    const session = await ownerSession();
    if (!session.user)
      return noStore({ error: "Sign in again to check the customer's balance.", code: "session_expired" }, 401);
    if (!session.allowed)
      return noStore({ error: "Shop owner access is required.", code: "access_denied" }, 403);
    const { data, error } = await session.supabase
      .from("money_owed")
      .select("amount")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (error)
      return noStore({ error: "Could not load the current balance. Try again." }, 503);
    const amount = data?.amount ?? 0;
    if (!Number.isSafeInteger(amount) || amount < 0)
      return noStore({ error: "Could not verify the customer balance. Try again." }, 503);
    return noStore({ amount });
  } catch {
    return noStore({ error: "Could not load the current balance. Try again." }, 503);
  }
}
