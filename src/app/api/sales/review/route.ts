import { NextResponse, type NextRequest } from "next/server";
import { reviewSaleInputs } from "@/app/(shop)/record-sale/actions";
import { ownerSession } from "@/lib/auth/owner";
import { parseLimitedJson, RequestBodyTooLarge } from "@/domain/limited-json";
import { saleReviewMissingUserResponse, saleReviewOwnerAccessResponse } from "@/domain/sale-errors";

export const dynamic = "force-dynamic";

// The review uses its own HTTP request so it cannot be queued behind stalled
// client-side Server Functions (such as a background catalogue refresh).
// The existing server review performs owner authentication and independently
// validates the catalogue, stock and previous customer balance.
type ReviewStage =
  | "complete" | "user_session" | "owner_access" | "auth_transport"
  | "content_type" | "payload_size" | "payload_parse"
  | "customer_field" | "customer_id_format" | "customer_recheck"
  | "balance_or_catalog" | "unexpected";

function noStore(body: Record<string, unknown>, status = 200, stage: ReviewStage = "complete") {
  // Only a hardcoded error stage, status and code. NEVER log customer
  // identifiers, customer names, debts, receipt data, request bodies or tokens.
  const code = typeof body.code === "string" ? body.code : status === 200 ? "ok" : "unknown";
  console.info("[sale-review] completed", { status, code, stage });
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" },
  });
}

export async function POST(request: NextRequest) {
  console.info("[sale-review] started");
  // Authenticate before reading attacker-controlled request bytes.
  try {
    const session = await ownerSession();
    if (!session.user) {
      // Do not treat a transient Supabase getUser() failure as expiration.
      const failure = saleReviewMissingUserResponse(session.authError);
      return noStore({ error: failure.error, code: failure.code }, failure.status, "user_session");
    }
    if (!session.allowed) {
      // A failed owner RPC is a retryable outage, not a proven access denial.
      const failure = saleReviewOwnerAccessResponse(session.ownerError);
      return noStore({ error: failure.error, code: failure.code }, failure.status, "owner_access");
    }
  } catch {
    return noStore({ error: "Could not verify your session. Try again.", code: "network_error" }, 503, "auth_transport");
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
    return noStore({ error: "Expected JSON request.", code: "customer_invalid" }, 415, "content_type");
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 1024)
    return noStore({ error: "Request too large.", code: "customer_invalid" }, 413, "payload_size");
  let customerId: unknown;
  try {
    const input: unknown = await parseLimitedJson(request.body, 1024);
    if (typeof input !== "object" || input === null || !("customerId" in input))
      return noStore({ error: "Choose a customer first.", code: "customer_invalid" }, 400, "customer_field");
    customerId = input.customerId;
  } catch (error) {
    if (error instanceof RequestBodyTooLarge)
      return noStore({ error: "Request too large.", code: "customer_invalid" }, 413);
    return noStore({ error: "Check the selected customer and retry.", code: "customer_invalid" }, 400, "payload_parse");
  }
  if (typeof customerId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerId))
    return noStore({ error: "Choose a customer first.", code: "customer_invalid" }, 400, "customer_id_format");

  try {
    const result = await reviewSaleInputs(customerId);
    if ("error" in result)
      return noStore({
        error: result.error,
        code: result.code ?? "network_error",
      }, result.code === "session_expired" ? 401 : result.code === "customer_invalid" ? 400 : 503,
        result.code === "customer_invalid" ? "customer_recheck" : "balance_or_catalog");
    return noStore({ catalog: result.catalog, amount: result.amount });
  } catch {
    return noStore({ error: "Could not check the sale. Try Review again.", code: "network_error" }, 503, "unexpected");
  }
}
