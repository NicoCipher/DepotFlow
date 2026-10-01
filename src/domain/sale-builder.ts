import { formatQuantity, toBottles, validateStock } from "./quantity.ts";
import { normalizePhone } from "./customers.ts";
import { formatNaira } from "./products.ts";
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
    empty_family: string | null;
  } | null;
  bottles_returnable: boolean;
  bottle_type: string | null;
};
export function saleProductSetupIssue(product: SaleProduct): string | null {
  if (
    !product.crate_type ||
    product.crate_type.is_legacy ||
    product.crate_type.pocket_count === null ||
    !product.crate_type.empty_family
  )
    return "Crate details are not finished. Open this drink and choose the physical crate it uses.";
  if (product.crate_type.pocket_count !== product.bottles_per_crate)
    return "The physical crate does not match the bottles per crate. Fix the drink setup before selling it.";
  if (product.bottles_returnable && !product.bottle_type)
    return "The empty bottle name is missing. Fix the drink setup before selling it.";
  return null;
}

export const inactiveSaleCustomerMessage =
  "This customer is no longer active. Choose another customer.";

export type SaleCustomer = {
  id: string;
  name: string;
  phone: string;
  empties_deposit_required: boolean;
};
export type SaleCrateType = {
  id: string;
  name: string;
  is_legacy: boolean;
  pocket_count: number | null;
};
export type SaleSwapRule = {
  owed_crate_type_id: string;
  returned_crate_type_id: string;
};
export type SaleCrateDepositPrice = {
  pocket_count: number;
  complete_crate_amount: number;
  crate_only_amount: number | null;
};
export type SaleCatalog = {
  products: SaleProduct[];
  customers: SaleCustomer[];
  crateTypes: SaleCrateType[];
  swapRules: SaleSwapRule[];
  bottleDepositPrice?: number | null;
  crateDepositPrices?: SaleCrateDepositPrice[];
};
export type SaleQuantity = {
  eighths?: 0 | 1 | 3 | 5 | 7;
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
export function effectivePartialPrice(
  product: SaleProduct,
  part: "half" | "quarter",
) {
  const override =
    part === "half" ? product.half_crate_price : product.quarter_crate_price;
  const divisor = part === "half" ? 2 : 4;
  const label = part === "half" ? "Half-crate" : "Quarter-crate";
  const value =
    override ??
    (product.full_crate_price === null
      ? null
      : product.full_crate_price / divisor);
  if (value === null) throw new Error(`${label} price is not set.`);
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(
      override === null
        ? `Set a ${label.toLowerCase()} price override because the full-crate price does not divide into whole naira.`
        : "Check this drink’s prices.",
    );
  return value;
}
export function priceQuantity(product: SaleProduct, quantity: SaleQuantity) {
  const { crates, fraction, bottles } = quantity;
  const eighths = quantity.eighths ?? 0;
  if (![0, 1, 3, 5, 7].includes(eighths) || (eighths && (fraction || product.bottles_per_crate !== 24)))
    throw new Error("Choose a valid 24-bottle quantity.");
  if (
    ![crates, bottles].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    ![0, 1, 2, 3].includes(fraction)
  )
    throw new Error("Enter whole numbers, zero or more.");
  let totalBottles: number;
  try {
    totalBottles = toBottles(
      crates + (eighths ? eighths / 8 : fraction / 4),
      product.bottles_per_crate,
      bottles,
    );
  } catch {
    throw new Error("That fraction does not make a whole number of bottles.");
  }
  if (product.available === null)
    throw new Error("Stock has not been counted for this drink yet.");
  const stock = validateStock(totalBottles, product.available);
  if (!stock.valid) {
    if (product.available === 0)
      throw new Error("Out of stock. Change the quantity.");
    if (totalBottles > product.available)
      throw new Error(
        `Only ${formatQuantity(
          product.available,
          product.bottles_per_crate,
        )} available now. Change the quantity.`,
      );
    throw new Error(stock.message);
  }
  function price(value: number | null, label: string, units: number) {
    if (!units) return 0;
    if (value === null) throw new Error(`${label} price is not set.`);
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("Check this drink’s prices.");
    return value * units;
  }
  const smallPartPrice = eighths ? (product.full_crate_price === null ? null : product.full_crate_price * eighths / 8) : 0;
  if (eighths && (smallPartPrice === null || !Number.isSafeInteger(smallPartPrice)))
    throw new Error("The crate price does not give a whole-naira price for this bottle quantity.");
  const lineTotal =
    (smallPartPrice ?? 0) +
    price(product.full_crate_price, "Full-crate", crates) +
    (fraction >= 2 ? effectivePartialPrice(product, "half") : 0) +
    (fraction % 2 ? effectivePartialPrice(product, "quarter") : 0) +
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
export function saleQuantityLabel(q: SaleQuantity) {
  const fraction = ["", "¼", "½", "¾"][q.fraction];
  if (q.eighths) return [q.crates ? `${q.crates} ${q.crates === 1 ? "crate" : "crates"}` : "", `${q.eighths * 3 + q.bottles} bottles`].filter(Boolean).join(" + ");
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
  paymentMethod: string;
  allEmpties: boolean;
  returns: Record<string, { crates: string; bottles: string }>;
  emptiesV2: {
    decisions?: { productId: string; kind: "crate" | "bottle"; returnedType: string; quantity: string; decision: "accept" | "hold" }[];
    mode: "exact" | "actual";
    cratesTaken: Record<string, string>;
    returnedCrates: Record<string, string>;
    returnedBottles: Record<string, string>;
  };
  editingId: string;
  crates: string;
  fraction: 0 | 1 | 2 | 3;
  eighths?: 0 | 1 | 3 | 5 | 7;
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
  paymentMethod: "",
  allEmpties: true,
  returns: {},
  emptiesV2: {
    decisions: [],
    mode: "exact",
    cratesTaken: {},
    returnedCrates: {},
    returnedBottles: {},
  },
  editingId: "",
  crates: "0",
  fraction: 0,
  eighths: 0,
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
      ![0, 1, 3, 5, 7].includes(d.eighths ?? 0) ||
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
        ![0, 1, 3, 5, 7].includes(line.quantity.eighths ?? 0) ||
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
    function stringMap(raw: unknown) {
      const result: Record<string, string> = {};
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
      for (const [key, value] of Object.entries(raw))
        if (typeof value === "string") result[key] = value;
      return result;
    }
    const hasV2Empties =
      d.emptiesV2 &&
      typeof d.emptiesV2 === "object" &&
      !Array.isArray(d.emptiesV2);
    const rawEmpties = hasV2Empties ? d.emptiesV2 : {};
    const legacyNeedsReentry = !hasV2Empties && d.allEmpties === false;
    return {
      ...emptySaleDraft,
      ...d,
      step:
        legacyNeedsReentry && (d.step === "payment" || d.step === "review")
          ? "empties"
          : d.step,
      businessDate: typeof d.businessDate === "string" ? d.businessDate : "",
      paid: typeof d.paid === "string" ? d.paid : "0",
      paymentMethod: typeof d.paymentMethod === "string" ? d.paymentMethod : "",
      allEmpties: typeof d.allEmpties === "boolean" ? d.allEmpties : true,
      returns,
      emptiesV2: {
        mode:
          hasV2Empties && rawEmpties.mode === "actual"
            ? "actual"
            : legacyNeedsReentry
              ? "actual"
              : "exact",
        decisions: Array.isArray(rawEmpties.decisions) && rawEmpties.decisions.length <= 1000 && rawEmpties.decisions.every((entry: unknown) => {
          if (!entry || typeof entry !== "object") return false;
          const row = entry as Record<string, unknown>;
          return typeof row.productId === "string" && typeof row.returnedType === "string" && typeof row.quantity === "string" && ["crate", "bottle"].includes(String(row.kind)) && ["accept", "hold"].includes(String(row.decision));
        }) ? rawEmpties.decisions : [],
        cratesTaken: stringMap(rawEmpties.cratesTaken),
        returnedCrates: stringMap(rawEmpties.returnedCrates),
        returnedBottles: stringMap(rawEmpties.returnedBottles),
      },
    } as SaleDraft;
  } catch {
    return emptySaleDraft;
  }
}

/** Authoritative inputs used by this quantity are compared; totals are never restored. */
export function salePriceSnapshot(product: SaleProduct, q: SaleQuantity) {
  return JSON.stringify([
    q.crates || q.fraction || q.eighths ? product.full_crate_price : null,
    q.fraction ? product.half_crate_price : null,
    q.fraction ? product.quarter_crate_price : null,
    q.bottles ? product.bottle_price : null,
  ]);
}

function storedPriceTotal(line: DraftLine): number | null {
  if (!line.priceSnapshot) return null;
  try {
    const parsed = JSON.parse(line.priceSnapshot);
    if (!Array.isArray(parsed) || parsed.length !== 4) return null;
    const [full, half, quarter, bottle] = parsed as unknown[];
    for (const value of [full, half, quarter, bottle])
      if (
        value !== null &&
        (!Number.isSafeInteger(value) || (value as number) < 0)
      )
        return null;

    function required(value: unknown) {
      return typeof value === "number" ? value : null;
    }
    function partial(override: unknown, divisor: 2 | 4) {
      const set = required(override);
      if (set !== null) return set;
      const fullPrice = required(full);
      if (fullPrice === null) return null;
      const value = fullPrice / divisor;
      return Number.isSafeInteger(value) ? value : null;
    }

    let total = 0;
    if (line.quantity.eighths) {
      const fullPrice = required(full);
      if (fullPrice === null) return null;
      total += fullPrice * line.quantity.eighths / 8;
    }
    if (line.quantity.crates) {
      const fullPrice = required(full);
      if (fullPrice === null) return null;
      total += fullPrice * line.quantity.crates;
    }
    if (line.quantity.fraction >= 2) {
      const halfPrice = partial(half, 2);
      if (halfPrice === null) return null;
      total += halfPrice;
    }
    if (line.quantity.fraction % 2) {
      const quarterPrice = partial(quarter, 4);
      if (quarterPrice === null) return null;
      total += quarterPrice;
    }
    if (line.quantity.bottles) {
      const bottlePrice = required(bottle);
      if (bottlePrice === null) return null;
      total += bottlePrice * line.quantity.bottles;
    }
    return Number.isSafeInteger(total) ? total : null;
  } catch {
    return null;
  }
}

export function salePriceChangeMessage(
  line: DraftLine,
  product: SaleProduct,
): string | null {
  if (
    line.priceSnapshot === undefined ||
    line.priceSnapshot === salePriceSnapshot(product, line.quantity)
  )
    return null;

  const oldTotal = storedPriceTotal(line);
  let newTotal: number | null = null;
  try {
    newTotal = priceQuantity(
      { ...product, available: Number.MAX_SAFE_INTEGER },
      line.quantity,
    ).lineTotal;
  } catch {
    /* A missing or invalid new price is explained by the regular line check. */
  }

  if (oldTotal !== null && newTotal !== null)
    return `${product.name}: Price for this quantity changed from ${formatNaira(
      oldTotal,
    )} to ${formatNaira(newTotal)}.`;

  return `${product.name}: Price changed. Current prices are shown.`;
}
export function quantityPriceSet(product: SaleProduct, q: SaleQuantity) {
  return (
    (!(q.crates || q.eighths) || product.full_crate_price !== null) &&
    (!(q.fraction >= 2) ||
      product.half_crate_price !== null ||
      product.full_crate_price !== null) &&
    (!(q.fraction % 2) ||
      product.quarter_crate_price !== null ||
      product.full_crate_price !== null) &&
    (!q.bottles || product.bottle_price !== null)
  );
}
export function revalidateSaleDraft(draft: SaleDraft, catalog: SaleCatalog) {
  const warnings: string[] = [];
  if (
    draft.customerId &&
    !catalog.customers.some((c) => c.id === draft.customerId)
  )
    warnings.push(inactiveSaleCustomerMessage);
  for (const line of draft.lines) {
    const p = catalog.products.find((p) => p.id === line.productId);
    if (!p) {
      warnings.push(
        "A drink is no longer available. Remove it from this sale.",
      );
      continue;
    }
    const setupIssue = saleProductSetupIssue(p);
    if (setupIssue) {
      warnings.push(`${p.name}: ${setupIssue}`);
      continue;
    }
    const priceChange = salePriceChangeMessage(line, p);
    if (priceChange) warnings.push(priceChange);
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
