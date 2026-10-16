import { NextResponse, type NextRequest } from "next/server";
import { reviewSaleInputs } from "@/app/(shop)/record-sale/actions";
import { ownerSession } from "@/lib/auth/owner";
import { parseLimitedJson, RequestBodyTooLarge } from "@/domain/limited-json";
import { saleReviewMissingUserResponse, saleReviewOwnerAccessResponse } from "@/domain/sale-errors";
import { saleReviewCustomerHeader, validSaleReviewCustomerId } from "@/domain/sale-review-customer";

export const dynamic = "force-dynamic";

// The review uses its own HTTP request so it cannot be queued behind stalled
// client-side Server Functions (such as a background catalogue refresh).
// The existing server review performs owner authentication and independently
// validates the catalogue, stock and previous customer balance.
function noStore(body: Record<string, unknown>, status = 200, stage = "completed") {
  // Privacy-preserving diagnostic: static stages only, no customer IDs,
  // request headers/bodies, financial values, or authentication tokens.
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
      return noStore({ error: failure.error, code: failure.code }, failure.status);
    }
    if (!session.allowed) {
      // A failed owner RPC is a retryable outage, not a proven access denial.
      const failure = saleReviewOwnerAccessResponse(session.ownerError);
      return noStore({ error: failure.error, code: failure.code }, failure.status);
    }
  } catch {
    return noStore({ error: "Could not verify your session. Try again.", code: "network_error" }, 503);
  }
  // Modern checkout supplies a validated, same-origin custom header so
  // streaming/body-parser behaviour cannot silently block the customer's
  // otherwise valid Review. The existing JSON route remains a fallback for
  // older cached clients. Neither input is trusted without authentication.
  const headerId = request.headers.get(saleReviewCustomerHeader);
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > 1024)
    return noStore({ error: "Request too large.", code: "customer_invalid" }, 413, "body_limit");

  let customerId: string;
  if (headerId !== null) {
    if (!validSaleReviewCustomerId(headerId))
      return noStore({ error: "The selected customer is invalid. Return to Customer and select them again.", code: "customer_invalid" }, 400, "invalid_header");
    customerId = headerId;
  } else {
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      return noStore({ error: "Expected JSON request.", code: "customer_invalid" }, 415, "legacy_content_type");
    let input: unknown;
    try {
      input = await parseLimitedJson(request.body, 1024);
    } catch (error) {
      if (error instanceof RequestBodyTooLarge)
        return noStore({ error: "Request too large.", code: "customer_invalid" }, 413, "legacy_body_limit");
      return noStore({ error: "Could not read the sale's customer. Refresh the page and try Review again.", code: "customer_invalid" }, 400, "legacy_json_parse");
    }
    if (typeof input !== "object" || input === null || !("customerId" in input))
      return noStore({ error: "Choose a customer first.", code: "customer_invalid" }, 400, "legacy_missing_field");
    if (!validSaleReviewCustomerId(input.customerId))
      return noStore({ error: "The selected customer is invalid. Return to Customer and select them again.", code: "customer_invalid" }, 400, "legacy_invalid_uuid");
    customerId = input.customerId;
  }
  console.info("[sale-review] customer validated", { source: headerId === null ? "legacy_json" : "header" });

  try {
    const result = await reviewSaleInputs(customerId);
    if ("error" in result)
      return noStore({
        error: result.error,
        code: result.code ?? "network_error",
      }, result.code === "session_expired" ? 401 : result.code === "customer_invalid" ? 400 : 503, "review_inputs");
    return noStore({ catalog: result.catalog, amount: result.amount });
  } catch {
    return noStore({ error: "Could not check the sale. Try Review again.", code: "network_error" }, 503);
  }
}
