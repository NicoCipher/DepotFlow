import { toBottles, validateStock } from "./quantity.ts";
import { normalizePhone } from "./customers.ts";
export type SaleProduct = {
  id: string;
  name: string;
  size: string | null;
  image_url: string | null;
  bottles_per_crate: number;
  full_crate_price: number | null;
  half_crate_price: number | null;
  quarter_crate_price: number | null;
  bottle_price: number | null;
  available: number | null;
  crate_type_id: string;
  crate_type: {
    name: string;
    is_legacy: boolean;
    pocket_count: number | null;
  } | null;
  bottles_returnable: boolean;
  bottle_type: string | null;
};
export type SaleCustomer = { id: string; name: string; phone: string };
export type SaleCatalog = {
  products: SaleProduct[];
  customers: SaleCustomer[];
};
export type SaleQuantity = {
  crates: number;
  fraction: 0 | 1 | 2 | 3;
  bottles: number;
};
export type DraftLine = {
  productId: string;
  quantity: SaleQuantity;
  priceSnapshot?: string;
  crateSizeSnapshot?: number;
  reviewExpected?: {
    full: number | null;
    half: number | null;
    quarter: number | null;
    bottle: number | null;
    size: number;
    crate: string;
    returnable: boolean;
    bottleType: string | null;
    stock: number | null;
  };
};
export function reviewedLine(line: DraftLine, p: SaleProduct): DraftLine {
  return {
    ...line,
    reviewExpected: {
      full: p.full_crate_price,
      half: p.half_crate_price,
      quarter: p.quarter_crate_price,
      bottle: p.bottle_price,
      size: p.bottles_per_crate,
      crate: p.crate_type_id,
      returnable: p.bottles_returnable,
      bottleType: p.bottle_type,
      stock: p.available,
    },
  };
}
export function reviewedLineTotal(line: DraftLine) {
  const e = line.reviewExpected;
  if (!e) throw new Error("Review current prices and stock before saving.");
  return priceQuantity(
    {
      id: line.productId,
      name: "Drink",
      size: null,
      image_url: null,
      bottles_per_crate: e.size,
      full_crate_price: e.full,
      half_crate_price: e.half,
      quarter_crate_price: e.quarter,
      bottle_price: e.bottle,
      available: Number.MAX_SAFE_INTEGER,
      crate_type_id: e.crate,
      crate_type: null,
      bottles_returnable: e.returnable,
      bottle_type: e.bottleType,
    },
    line.quantity,
  ).lineTotal;
}
export function reviewedTotal(lines: DraftLine[]) {
  if (
    !lines.length ||
    new Set(lines.map((line) => line.productId)).size !== lines.length
  )
    throw new Error("Review the drinks in this sale.");
  const total = lines.reduce((sum, line) => sum + reviewedLineTotal(line), 0);
  if (!Number.isSafeInteger(total)) throw new Error("That total is too large.");
  return total;
}
export function priceQuantity(product: SaleProduct, quantity: SaleQuantity) {
  const { crates, fraction, bottles } = quantity;
  if (
    ![crates, bottles].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    ![0, 1, 2, 3].includes(fraction)
  )
    throw new Error("Enter whole numbers, zero or more.");
  let totalBottles: number;
  try {
    totalBottles = toBottles(
      crates + fraction / 4,
      product.bottles_per_crate,
      bottles,
    );
  } catch {
    throw new Error("That fraction does not make a whole number of bottles.");
  }
  if (product.available === null)
    throw new Error("Stock not recorded for this drink.");
  const stock = validateStock(totalBottles, product.available);
  if (!stock.valid) throw new Error(stock.message);
  function price(value: number | null, label: string, units: number) {
    if (!units) return 0;
    if (value === null) throw new Error(`${label} price is not set.`);
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Check this drink’s prices.");
    return value * units;
  }
  const lineTotal =
    price(product.full_crate_price, "Full-crate", crates) +
    price(product.half_crate_price, "Half-crate", fraction >= 2 ? 1 : 0) +
    price(product.quarter_crate_price, "Quarter-crate", fraction % 2) +
    price(product.bottle_price, "Bottle", bottles);
  if (!Number.isSafeInteger(lineTotal))
    throw new Error("That total is too large.");
  return { totalBottles, lineTotal };
}
export function putSaleLine(
  lines: DraftLine[],
  line: DraftLine,
  product: SaleProduct,
): DraftLine[] {
  if (line.productId !== product.id) throw new Error("Choose a drink.");
  priceQuantity(product, line.quantity);
  line = {
    ...line,
    priceSnapshot: salePriceSnapshot(product, line.quantity),
    crateSizeSnapshot: product.bottles_per_crate,
  };
  const index = lines.findIndex((item) => item.productId === line.productId);
  return index < 0
    ? [...lines, line]
    : lines.map((item, i) => (i === index ? line : item));
}
export function removeSaleLine(lines: DraftLine[], productId: string) {
  return lines.filter((line) => line.productId !== productId);
}
export function saleTotal(lines: DraftLine[], products: SaleProduct[]) {
  if (new Set(lines.map((line) => line.productId)).size !== lines.length)
    throw new Error("Review duplicate drinks.");
  const total = lines.reduce((sum, line) => {
    const product = products.find((p) => p.id === line.productId);
    if (!product)
      throw new Error(
        "A drink is no longer available. Remove it from this sale.",
      );
    return sum + priceQuantity(product, line.quantity).lineTotal;
  }, 0);
  if (!Number.isSafeInteger(total)) throw new Error("That total is too large.");
  return total;
}
export function emptiesFor(line: DraftLine, product: SaleProduct) {
  const fractional =
    (line.quantity.fraction * product.bottles_per_crate) / 4 +
    line.quantity.bottles;
  if (!Number.isSafeInteger(fractional))
    throw new Error("Check the bottle quantity.");
  if (
    line.quantity.crates &&
    (product.crate_type?.is_legacy ||
      product.crate_type?.pocket_count !== product.bottles_per_crate)
  )
    throw new Error(
      `${product.name}: Choose an exact crate type before saving.`,
    );
  return {
    crates: line.quantity.crates,
    bottles: product.bottles_returnable
      ? line.quantity.crates * product.bottles_per_crate + fractional
      : 0,
  };
}
export function returnedEmpties(
  draft: SaleDraft,
  line: DraftLine,
  product: SaleProduct,
) {
  const due = emptiesFor(line, product);
  const entry = draft.returns[line.productId];
  function count(raw: string | undefined, max: number) {
    if (draft.allEmpties) return max;
    if (raw === undefined || !/^\d+$/.test(raw))
      throw new Error("Enter whole numbers of returned empties.");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value > max)
      throw new Error("Returned empties cannot exceed those in this sale.");
    return value;
  }
  return {
    crates: count(entry?.crates, due.crates),
    bottles: count(entry?.bottles, due.bottles),
  };
}
export function saleQuantityLabel(q: SaleQuantity) {
  const fraction = ["", "¼", "½", "¾"][q.fraction];
  const parts = [];
  if (q.crates || fraction)
    parts.push(
      `${q.crates || ""}${fraction} ${(q.crates === 1 && !fraction) || !q.crates ? "crate" : "crates"}`,
    );
  if (q.bottles)
    parts.push(`${q.bottles} ${q.bottles === 1 ? "bottle" : "bottles"}`);
  return parts.join(" + ");
}
export function matchesSaleCustomer(customer: SaleCustomer, query: string) {
  const term = query.trim().toLowerCase();
  const phone = normalizePhone(term).replace(/^0(?=\d)/, "+234");
  return (
    customer.name.toLowerCase().includes(term) || customer.phone.includes(phone)
  );
}
export type SaleDraft = {
  customerId: string;
  lines: DraftLine[];
  step:
    | "customer"
    | "drinks"
    | "quantity"
    | "check"
    | "empties"
    | "payment"
    | "review";
  businessDate: string;
  paid: string;
  allEmpties: boolean;
  returns: Record<string, { crates: string; bottles: string }>;
  editingId: string;
  crates: string;
  fraction: 0 | 1 | 2 | 3;
  bottles: string;
  customerQuery: string;
  productQuery: string;
};
export const emptySaleDraft: SaleDraft = {
  customerId: "",
  lines: [],
  step: "customer",
  businessDate: "",
  paid: "0",
  allEmpties: true,
  returns: {},
  editingId: "",
  crates: "0",
  fraction: 0,
  bottles: "0",
  customerQuery: "",
  productQuery: "",
};
export function readSaleDraft(raw: string | null): SaleDraft {
  try {
    const d = JSON.parse(raw ?? "null");
    if (
      !d ||
      ![
        "customer",
        "drinks",
        "quantity",
        "check",
        "empties",
        "payment",
        "review",
      ].includes(d.step) ||
      ![0, 1, 2, 3].includes(d.fraction) ||
      ![
        "customerId",
        "editingId",
        "crates",
        "bottles",
        "customerQuery",
        "productQuery",
      ].every((k) => typeof d[k] === "string") ||
      !Array.isArray(d.lines) ||
      d.lines.length > 1000
    )
      return emptySaleDraft;
    for (const line of d.lines)
      if (
        typeof line.productId !== "string" ||
        !line.quantity ||
        ![0, 1, 2, 3].includes(line.quantity.fraction) ||
        ![line.quantity.crates, line.quantity.bottles].every(
          (n) => Number.isSafeInteger(n) && n >= 0,
        )
      )
        return emptySaleDraft;
    if (
      new Set(d.lines.map((line: DraftLine) => line.productId)).size !==
      d.lines.length
    )
      return emptySaleDraft;
    const returns: SaleDraft["returns"] = {};
    if (
      d.returns &&
      typeof d.returns === "object" &&
      !Array.isArray(d.returns)
    ) {
      for (const [id, entry] of Object.entries(d.returns)) {
        if (
          entry &&
          typeof entry === "object" &&
          typeof (entry as { crates?: unknown }).crates === "string" &&
          typeof (entry as { bottles?: unknown }).bottles === "string"
        )
          returns[id] = entry as { crates: string; bottles: string };
      }
    }
    return {
      ...emptySaleDraft,
      ...d,
      businessDate: typeof d.businessDate === "string" ? d.businessDate : "",
      paid: typeof d.paid === "string" ? d.paid : "0",
      allEmpties: typeof d.allEmpties === "boolean" ? d.allEmpties : true,
      returns,
    } as SaleDraft;
  } catch {
    return emptySaleDraft;
  }
}

/** Only configured prices used by this quantity are compared; totals are never restored. */
export function salePriceSnapshot(product: SaleProduct, q: SaleQuantity) {
  return JSON.stringify([
    q.crates ? product.full_crate_price : null,
    q.fraction >= 2 ? product.half_crate_price : null,
    q.fraction % 2 ? product.quarter_crate_price : null,
    q.bottles ? product.bottle_price : null,
  ]);
}
export function quantityPriceSet(product: SaleProduct, q: SaleQuantity) {
  return (
    (!q.crates || product.full_crate_price !== null) &&
    (!(q.fraction >= 2) || product.half_crate_price !== null) &&
    (!(q.fraction % 2) || product.quarter_crate_price !== null) &&
    (!q.bottles || product.bottle_price !== null)
  );
}
export function revalidateSaleDraft(draft: SaleDraft, catalog: SaleCatalog) {
  const warnings: string[] = [];
  if (
    draft.customerId &&
    !catalog.customers.some((c) => c.id === draft.customerId)
  )
    warnings.push("Customer no longer available. Choose another customer.");
  for (const line of draft.lines) {
    const p = catalog.products.find((p) => p.id === line.productId);
    if (!p) {
      warnings.push(
        "A drink is no longer available. Remove it from this sale.",
      );
      continue;
    }
    if (
      line.priceSnapshot !== undefined &&
      line.priceSnapshot !== salePriceSnapshot(p, line.quantity)
    )
      warnings.push(`${p.name}: Price changed. Current prices are shown.`);
    if (
      line.crateSizeSnapshot !== undefined &&
      line.crateSizeSnapshot !== p.bottles_per_crate
    )
      warnings.push(
        `${p.name}: Bottles per crate changed. Check the quantity.`,
      );
    try {
      priceQuantity(p, line.quantity);
    } catch (error) {
      warnings.push(`${p.name}: ${(error as Error).message}`);
    }
  }
  let total: number | undefined;
  try {
    total = saleTotal(draft.lines, catalog.products);
  } catch {
    /* Invalid lines must be corrected before a grand total is shown. */
  }
  return { warnings, total };
}
