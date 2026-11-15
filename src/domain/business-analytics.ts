/**
 * Pure, business-scoped calculations for DepotFlow's first analytics phase.
 *
 * This module does not fetch data or establish authorization. Callers must use
 * an authorized data source and pass rows for the requested business. The
 * explicit businessId filter is a second line of defence against accidentally
 * mixing rows returned by a broader query.
 *
 * Collections are sale payments plus standalone customer repayments. Tender
 * legs are deliberately not an input: they describe allocations of money
 * already represented by sales.paidAmount and customer payment rows.
 */

export type AnalyticsReceiptStatus = "valid" | "voided";

export type AnalyticsSale = {
  id: string;
  businessId: string;
  businessDate: string;
  totalAmount: number;
  paidAmount: number;
  receiptStatus: AnalyticsReceiptStatus;
};

export type AnalyticsCustomerPayment = {
  id: string;
  businessId: string;
  businessDate: string;
  amount: number;
  receiptStatus: AnalyticsReceiptStatus;
};

export type AnalyticsCustomerBalance = {
  customerId: string;
  businessId: string;
  amount: number;
};

export type CoreFinancialMetrics = {
  /** Valid sale value in the selected inclusive business-date range. */
  salesValue: number;
  salesCount: number;
  /** Zero when there are no valid sales in the range. */
  averageSale: number;
  /** Sale portion paid during the selected range; excludes debt repayments. */
  salePaymentsReceived: number;
  /** Valid standalone customer repayments during the selected range. */
  debtRepayments: number;
  /** Sale payments plus standalone repayments, counted exactly once. */
  cashCollected: number;
  /** Credit newly issued by valid sales in the selected range. */
  creditIssued: number;
  /** Current debt balance; this is not a historical as-of balance. */
  outstandingDebt: number;
  customersOwing: number;
};

const MAX_SAFE_TOTAL = Number.MAX_SAFE_INTEGER;

function assertBusinessId(businessId: string): void {
  if (typeof businessId !== "string" || businessId.trim() === "") {
    throw new Error("Choose a business before calculating reports.");
  }
}

function assertIsoDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Enter ${label} as YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`Enter a valid ${label} date.`);
  }
}

function inDateRange(date: string, startDate: string, endDate: string): boolean {
  // ISO calendar dates sort lexicographically and avoid browser-local timezone drift.
  return date >= startDate && date <= endDate;
}

function assertAmount(value: number, label: string, allowZero = true): void {
  if (!Number.isSafeInteger(value) || value < 0 || (!allowZero && value === 0)) {
    throw new Error(`Invalid ${label} amount in report data.`);
  }
}

function safeAdd(current: number, amount: number, label: string): number {
  const result = current + amount;
  if (!Number.isSafeInteger(result) || result > MAX_SAFE_TOTAL) {
    throw new Error(`${label} exceeds the safe reporting limit.`);
  }
  return result;
}

export function calculateCoreFinancialMetrics(input: {
  businessId: string;
  startDate: string;
  endDate: string;
  sales: readonly AnalyticsSale[];
  customerPayments: readonly AnalyticsCustomerPayment[];
  currentBalances: readonly AnalyticsCustomerBalance[];
}): CoreFinancialMetrics {
  const { businessId, startDate, endDate } = input;
  assertBusinessId(businessId);
  assertIsoDate(startDate, "start");
  assertIsoDate(endDate, "end");
  if (startDate > endDate) {
    throw new Error("The report start date must be on or before its end date.");
  }

  let salesValue = 0;
  let salesCount = 0;
  let salePaymentsReceived = 0;
  let creditIssued = 0;

  for (const sale of input.sales) {
    if (sale.businessId !== businessId || sale.receiptStatus !== "valid") continue;
    assertIsoDate(sale.businessDate, "business");
    if (!inDateRange(sale.businessDate, startDate, endDate)) continue;

    assertAmount(sale.totalAmount, "sale total", false);
    assertAmount(sale.paidAmount, "sale payment");
    if (sale.paidAmount > sale.totalAmount) {
      throw new Error("Invalid sale data: paid amount exceeds the sale total.");
    }

    salesValue = safeAdd(salesValue, sale.totalAmount, "Sales value");
    salePaymentsReceived = safeAdd(salePaymentsReceived, sale.paidAmount, "Sale payments");
    creditIssued = safeAdd(creditIssued, sale.totalAmount - sale.paidAmount, "Credit issued");
    salesCount += 1;
  }

  let debtRepayments = 0;
  for (const payment of input.customerPayments) {
    if (payment.businessId !== businessId || payment.receiptStatus !== "valid") continue;
    assertIsoDate(payment.businessDate, "business");
    if (!inDateRange(payment.businessDate, startDate, endDate)) continue;
    assertAmount(payment.amount, "customer payment", false);
    debtRepayments = safeAdd(debtRepayments, payment.amount, "Debt repayments");
  }

  let outstandingDebt = 0;
  const customersOwingIds = new Set<string>();
  for (const balance of input.currentBalances) {
    if (balance.businessId !== businessId) continue;
    assertAmount(balance.amount, "customer balance");
    if (balance.amount === 0) continue;
    if (!balance.customerId) {
      throw new Error("Invalid customer balance: missing customer identifier.");
    }
    outstandingDebt = safeAdd(outstandingDebt, balance.amount, "Outstanding debt");
    customersOwingIds.add(balance.customerId);
  }

  return {
    salesValue,
    salesCount,
    averageSale: salesCount === 0 ? 0 : salesValue / salesCount,
    salePaymentsReceived,
    debtRepayments,
    cashCollected: safeAdd(salePaymentsReceived, debtRepayments, "Cash collected"),
    creditIssued,
    outstandingDebt,
    customersOwing: customersOwingIds.size,
  };
}
