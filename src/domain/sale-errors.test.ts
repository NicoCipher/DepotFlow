import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SaleSaveTimeoutError,
  saleSaveCheckingMessage,
  saleSaveRetryMessage,
  withSaleSaveTimeout,
} from "./sale-errors.ts";

test("slow save reports an explicit timeout for recovery", async () => {
  await assert.rejects(
    withSaleSaveTimeout(
      new Promise((resolve) => setTimeout(() => resolve("late"), 25)),
      2,
    ),
    SaleSaveTimeoutError,
  );
});

test("completed save passes through before the timeout", async () => {
  assert.equal(
    await withSaleSaveTimeout(Promise.resolve("saved"), 50),
    "saved",
  );
});

test("timeout recovery copy says DepotFlow is checking before asking for a retry", () => {
  assert.match(saleSaveCheckingMessage, /Checking whether it already saved/);
  assert.match(saleSaveRetryMessage, /sale is still here/);
  assert.match(saleSaveRetryMessage, /safe to retry/);
});
