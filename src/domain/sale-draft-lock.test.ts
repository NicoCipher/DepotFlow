import assert from "node:assert/strict";
import { test } from "node:test";
import { withBoundedSaleDraftLock } from "./sale-draft-lock.ts";

test("draft persistence happens when lock is available", async () => {
  let count = 0;
  const locks = {
    request: ((_name: string, _opts: LockOptions, callback: () => void) => callback()) as LockManager["request"],
  };
  await withBoundedSaleDraftLock(locks, "sale-test", () => { count++; }, 500);
  assert.equal(count, 1);
});

test("a suspended browser tab cannot block draft navigation indefinitely", async () => {
  let count = 0;
  const locks = {
    request: ((_name: string, opts: LockOptions) =>
      new Promise((_resolve, reject) => {
        opts.signal?.addEventListener("abort", () => reject(new Error("Aborted")), { once: true });
      })) as LockManager["request"],
  };
  await assert.rejects(
    withBoundedSaleDraftLock(locks, "sale-test", () => { count++; }, 20),
    /sale draft is busy in another tab/i,
  );
  assert.equal(count, 0, "Timed-out lock never wrote an unfinished draft");
});
