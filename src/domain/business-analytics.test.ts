import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateCoreFinancialMetrics } from "./business-analytics.ts";

const base = {
  businessId: "walnik",
  startDate: "2026-10-01",
  endDate: "2026-10-31",
};

test("calculates core metrics without double-counting split-tender allocations", () => {
  const result = calculateCoreFinancialMetrics({
    ...base,
    sales: [
      {
        id: "sale-1", businessId: "walnik", businessDate: "2026-10-12",
        totalAmount: 2000, paidAmount: 1500, receiptStatus: "valid",
      },
      {
        id: "sale-2", businessId: "walnik", businessDate: "2026-10-13",
        totalAmount: 1400, paidAmount: 700, receiptStatus: "valid",
      },
    ],
    customerPayments: [
      {
        id: "repayment-1", businessId: "walnik", businessDate: "2026-10-13",
        amount: 2600, receiptStatus: "valid",
      },
    ],
    currentBalances: [
      { customerId: "customer-1", businessId: "walnik", amount: 500 },
      { customerId: "customer-2", businessId: "walnik", amount: 300 },
      { customerId: "customer-3", businessId: "walnik", amount: 0 },
    ],
  });

  assert.deepEqual(result, {
    salesValue: 3400,
    salesCount: 2,
    averageSale: 1700,
    salePaymentsReceived: 2200,
    debtRepayments: 2600,
    cashCollected: 4800,
    creditIssued: 1200,
    outstandingDebt: 800,
    customersOwing: 2,
  });
});

test("excludes voided records and never includes foreign-business rows", () => {
  const result = calculateCoreFinancialMetrics({
    ...base,
    sales: [
      {
        id: "valid", businessId: "walnik", businessDate: "2026-10-12",
        totalAmount: 1000, paidAmount: 500, receiptStatus: "valid",
      },
      {
        id: "void", businessId: "walnik", businessDate: "2026-10-12",
        totalAmount: 9000, paidAmount: 9000, receiptStatus: "voided",
      },
      {
        id: "foreign", businessId: "other-shop", businessDate: "2026-10-12",
        totalAmount: 7000, paidAmount: 7000, receiptStatus: "valid",
      },
    ],
    customerPayments: [
      {
        id: "valid-repayment", businessId: "walnik", businessDate: "2026-10-12",
        amount: 200, receiptStatus: "valid",
      },
      {
        id: "void-repayment", businessId: "walnik", businessDate: "2026-10-12",
        amount: 800, receiptStatus: "voided",
      },
      {
        id: "foreign-repayment", businessId: "other-shop", businessDate: "2026-10-12",
        amount: 900, receiptStatus: "valid",
      },
    ],
    currentBalances: [
      { customerId: "walnik-customer", businessId: "walnik", amount: 300 },
      { customerId: "foreign-customer", businessId: "other-shop", amount: 9000 },
    ],
  });

  assert.equal(result.salesValue, 1000);
  assert.equal(result.salesCount, 1);
  assert.equal(result.salePaymentsReceived, 500);
  assert.equal(result.debtRepayments, 200);
  assert.equal(result.cashCollected, 700);
  assert.equal(result.outstandingDebt, 300);
  assert.equal(result.customersOwing, 1);
});

test("uses inclusive business-date boundaries and ignores created-at concepts", () => {
  const result = calculateCoreFinancialMetrics({
    ...base,
    startDate: "2026-10-10",
    endDate: "2026-10-11",
    sales: [
      {
        id: "start", businessId: "walnik", businessDate: "2026-10-10",
        totalAmount: 100, paidAmount: 100, receiptStatus: "valid",
      },
      {
        id: "end", businessId: "walnik", businessDate: "2026-10-11",
        totalAmount: 200, paidAmount: 0, receiptStatus: "valid",
      },
      {
        id: "before", businessId: "walnik", businessDate: "2026-10-09",
        totalAmount: 300, paidAmount: 300, receiptStatus: "valid",
      },
      {
        id: "after", businessId: "walnik", businessDate: "2026-10-12",
        totalAmount: 400, paidAmount: 400, receiptStatus: "valid",
      },
    ],
    customerPayments: [],
    currentBalances: [],
  });

  assert.equal(result.salesValue, 300);
  assert.equal(result.salesCount, 2);
  assert.equal(result.creditIssued, 200);
});

test("returns zero average when the period has no valid sales", () => {
  const result = calculateCoreFinancialMetrics({
    ...base,
    sales: [],
    customerPayments: [],
    currentBalances: [],
  });
  assert.equal(result.averageSale, 0);
  assert.equal(result.cashCollected, 0);
});

test("rejects invalid ranges, invalid amounts, and paid amounts above sale total", () => {
  assert.throws(() => calculateCoreFinancialMetrics({
    ...base, startDate: "2026-11-01", endDate: "2026-10-01",
    sales: [], customerPayments: [], currentBalances: [],
  }), /on or before/i);

  assert.throws(() => calculateCoreFinancialMetrics({
    ...base,
    sales: [{
      id: "bad", businessId: "walnik", businessDate: "2026-10-12",
      totalAmount: 100, paidAmount: 101, receiptStatus: "valid",
    }],
    customerPayments: [],
    currentBalances: [],
  }), /paid amount exceeds/i);

  assert.throws(() => calculateCoreFinancialMetrics({
    ...base,
    sales: [],
    customerPayments: [{
      id: "bad-payment", businessId: "walnik", businessDate: "2026-10-12",
      amount: 0, receiptStatus: "valid",
    }],
    currentBalances: [],
  }), /invalid customer payment amount/i);
});

test("requires an explicit business scope and valid calendar dates", () => {
  assert.throws(() => calculateCoreFinancialMetrics({
    ...base, businessId: " ", sales: [], customerPayments: [], currentBalances: [],
  }), /choose a business/i);

  assert.throws(() => calculateCoreFinancialMetrics({
    ...base, startDate: "2026-02-30", sales: [], customerPayments: [], currentBalances: [],
  }), /valid start date/i);
});
