import assert from "node:assert/strict";
import { test } from "node:test";
import { requestSaleReview } from "./sale-review-http.ts";

const id = "11111111-1111-4111-8111-111111111111";
function mock(body: unknown, status = 200) {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(url, "/api/sales/review");
    assert.equal(init?.method, "POST");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(init?.body)), { customerId: id });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
}

test("review request uses independently retryable, no-store HTTP route", async () => {
  const data = { amount: 0, catalog: { products: [], customers: [] } };
  const result = await requestSaleReview(id, undefined, mock(data));
  assert.deepEqual(result, data);
});

test("review presents authentication failure as an explicit session expiry", async () => {
  const result = await requestSaleReview(id, undefined,
    mock({ error: "Sign in again.", code: "session_expired" }, 401));
  assert.deepEqual(result, { error: "Sign in again.", code: "session_expired" });
});

test("review accepts actionable prior-balance failure without silently advancing", async () => {
  const result = await requestSaleReview(id, undefined,
    mock({ error: "Could not verify this customer's balance.", code: "debt_unavailable" }, 503));
  assert.deepEqual(result, { error: "Could not verify this customer's balance.", code: "debt_unavailable" });
});

test("review refuses an incomplete or invalid HTTP response", async () => {
  await assert.rejects(requestSaleReview(id, undefined, mock({ amount: 0 })), /Could not verify/);
  await assert.rejects(requestSaleReview(id, undefined, mock({ amount: -1, catalog: { products: [], customers: [] } })), /Could not verify/);
});

test("abort cancels a stalled review so another request can proceed", async () => {
  let cancelled = false;
  const blocked = (async (_url: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        cancelled = true;
        reject(new DOMException("Review aborted", "AbortError"));
      }, { once: true });
    })) as typeof fetch;
  const controller = new AbortController();
  const waiting = requestSaleReview(id, controller.signal, blocked);
  controller.abort();
  await assert.rejects(waiting, /Review aborted/);
  assert.equal(cancelled, true);
  assert.deepEqual(await requestSaleReview(id, undefined, mock({
    amount: 0, catalog: { products: [], customers: [] },
  })), { amount: 0, catalog: { products: [], customers: [] } });
});
