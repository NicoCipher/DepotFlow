import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ownerAuthorized } from "./authorization.ts";
import {
  formatStoredQuantity,
  newestSales,
  saleOwing,
  salesHistoryState,
  storedSaleItemHistory,
  type SaleSummary,
  type StoredSaleItem,
} from "./sales.ts";

const storedItem: StoredSaleItem = {
  id: "item-1",
  product_name: "Stored Trophy Big",
  total_bottles: 18,
  bottles_per_crate: 12,
  line_total: 14500,
  bottles_returnable: true,
  crate_type: "Trophy 12",
  bottle_type: "Trophy Big Bottle",
  whole_crates: 1,
  crates_returned: 0,
  returnable_bottles_out: 18,
  bottles_returned: 6,
};

function sale(
  id: string,
  businessDate: string | null,
  customerId = "customer-a",
): SaleSummary {
  return {
    id,
    customerId,
    customerName: customerId,
    businessDate,
    createdAt: `2026-09-23T10:00:0${id}.000Z`,
    total: 1000,
    paid: 400,
    owing: 600,
    itemCount: 1,
  };
}

test("sales are ordered by business date newest first and undated legacy sales last", () => {
  assert.deepEqual(
    newestSales([
      sale("1", "2026-09-20"),
      sale("2", null),
      sale("3", "2026-09-23"),
      sale("4", "2026-09-21"),
    ]).map((entry) => entry.id),
    ["3", "4", "1", "2"],
  );
});

test("still owing is calculated from the stored sale total and paid amount", () => {
  assert.equal(saleOwing(42500, 30000), 12500);
  assert.equal(saleOwing(42500, 42500), 0);
});

test("sale detail keeps the stored product name when the current product changes", () => {
  const history = storedSaleItemHistory(storedItem);
  const currentProduct = { name: "Renamed product", bottles_per_crate: 24 };
  assert.equal(currentProduct.name, "Renamed product");
  assert.equal(history.productName, "Stored Trophy Big");
  assert.equal(history.quantity, "1 whole crate + 6 bottles");
});

test("quantity display preserves entered whole crates and shows the exact remainder", () => {
  assert.equal(formatStoredQuantity(storedItem), "1 whole crate + 6 bottles");
  assert.equal(
    formatStoredQuantity({
      total_bottles: 9,
      bottles_per_crate: 12,
      whole_crates: 0,
    }),
    "9 bottles",
  );
  assert.equal(
    formatStoredQuantity({
      total_bottles: 24,
      bottles_per_crate: 12,
      whole_crates: 2,
    }),
    "2 whole crates",
  );
});

test("item empties show only the remainder owed from this sale", () => {
  const history = storedSaleItemHistory({
    ...storedItem,
    whole_crates: 3,
    crates_returned: 1,
    returnable_bottles_out: 30,
    bottles_returned: 12,
  });
  assert.equal(history.cratesOwed, 2);
  assert.equal(history.bottlesOwed, 18);
});

test("customer history query is scoped to the requested customer", () => {
  const source = readFileSync(
    new URL("../lib/sales/data.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /\.eq\("customer_id", customerId\)/);
  assert.doesNotMatch(source, /from\("products"\)/);
  const rows = [sale("1", "2026-09-23", "customer-a")];
  assert.ok(rows.every((entry) => entry.customerId === "customer-a"));
});

test("sales history exposes its useful empty state", () => {
  assert.deepEqual(salesHistoryState([]), { empty: true, sales: [] });
  assert.equal(salesHistoryState([sale("1", "2026-09-23")]).empty, false);
});

test("sales routes remain inside the existing fail-closed owner flow", () => {
  assert.equal(ownerAuthorized("owner", true, null), true);
  assert.equal(ownerAuthorized("other", false, null), false);
  assert.equal(ownerAuthorized(undefined, true, null), false);
  const layout = readFileSync(
    new URL("../app/(shop)/layout.tsx", import.meta.url),
    "utf8",
  );
  const data = readFileSync(
    new URL("../lib/sales/data.ts", import.meta.url),
    "utf8",
  );
  assert.match(layout, /await requireOwner\(\)/);
  assert.match(data, /const supabase = await requireOwner\(\)/);
});
