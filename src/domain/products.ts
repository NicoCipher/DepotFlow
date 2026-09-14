import type { Product } from "./models";

export const productTextFields = [
  "name",
  "size",
  "image_url",
  "crate_type_id",
  "bottle_type",
] as const;
export const productPriceFields = [
  "full_crate_price",
  "half_crate_price",
  "quarter_crate_price",
  "bottle_price",
] as const;
export type ProductValues = Record<
  | (typeof productTextFields)[number]
  | (typeof productPriceFields)[number]
  | "bottles_per_crate"
  | "bottles_returnable",
  string
>;
export type ProductErrors = Partial<Record<keyof ProductValues, string>>;
export type ProductFormState = {
  values: ProductValues;
  errors: ProductErrors;
  message?: string;
};
export const emptyProduct: ProductValues = {
  name: "",
  size: "",
  image_url: "",
  bottles_per_crate: "",
  full_crate_price: "",
  half_crate_price: "",
  quarter_crate_price: "",
  bottle_price: "",
  bottles_returnable: "",
  crate_type_id: "",
  bottle_type: "",
};
export const isProductId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export const formatNaira = (amount: number) =>
  `₦${amount.toLocaleString("en-NG")}`;
export function validImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export function validateProduct(values: ProductValues) {
  const errors: ProductErrors = {};
  const text = (
    field: (typeof productTextFields)[number],
    max: number,
    required = false,
  ) => {
    const trimmed = values[field].trim();
    const value =
      field === "image_url" ? trimmed : trimmed.replace(/\s+/g, " ");
    if ((required && !value) || value.length > max)
      errors[field] =
        `Enter ${required ? "a value of " : ""}up to ${max} characters.`;
    return value || null;
  };
  const integer = (
    field: "bottles_per_crate" | (typeof productPriceFields)[number],
    required: boolean,
    minimum: number,
    step: number,
  ) => {
    const raw = values[field].trim();
    if (!raw && !required) return null;
    const value = Number(raw);
    // PostgreSQL integer bounds; reject decimals/exponents rather than rounding.
    if (
      !/^\d+$/.test(raw) ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      value > 2147483647 ||
      value % step !== 0
    ) {
      errors[field] =
        field === "bottles_per_crate"
          ? "Enter a positive whole number up to 2,147,483,647."
          : "Enter whole naira in ₦50 steps, up to ₦2,147,483,600.";
    }
    return value;
  };
  const name = text("name", 120, true) ?? "";
  const size = text("size", 80);
  const image_url = text("image_url", 2048);
  if (image_url && !validImageUrl(image_url))
    errors.image_url =
      "Enter a valid http or https image URL without login details.";
  const crate_type_id = values.crate_type_id;
  if (!isProductId(crate_type_id))
    errors.crate_type_id = "Choose an exact crate type.";
  const bottle_type = text(
    "bottle_type",
    120,
    values.bottles_returnable === "true",
  );
  if (
    values.bottles_returnable !== "true" &&
    values.bottles_returnable !== "false"
  )
    errors.bottles_returnable = "Choose Yes or No.";
  const data = {
    name,
    size,
    image_url,
    crate_type_id,
    bottle_type,
    bottles_per_crate: integer("bottles_per_crate", true, 1, 1) ?? 0,
    full_crate_price: integer("full_crate_price", true, 0, 50) ?? 0,
    half_crate_price: integer("half_crate_price", false, 0, 50),
    quarter_crate_price: integer("quarter_crate_price", false, 0, 50),
    bottle_price: integer("bottle_price", false, 0, 50),
    bottles_returnable: values.bottles_returnable === "true",
  };
  return { data, errors, valid: Object.keys(errors).length === 0 };
}
export type ProductDetails = ReturnType<typeof validateProduct>["data"];
export function productValues(product: Product): ProductValues {
  return Object.fromEntries(
    Object.keys(emptyProduct).map((field) => [
      field,
      String(product[field as keyof ProductValues] ?? ""),
    ]),
  ) as ProductValues;
}
export function sameProductDetails(
  a: ProductDetails,
  b: ProductDetails,
): boolean {
  return (Object.keys(emptyProduct) as (keyof ProductValues)[]).every(
    (field) => a[field] === b[field],
  );
}
export function normalizeProductSearch(query: string) {
  return query.trim().replace(/\s+/g, " ").slice(0, 120);
}
export function productSearchFilter(query: string) {
  const term = normalizeProductSearch(query);
  // Quote PostgREST reserved punctuation; escape LIKE wildcard characters.
  const pattern = JSON.stringify(`%${term.replace(/[\\%_*]/g, "\\$&")}%`);
  return `name.ilike.${pattern},size.ilike.${pattern}`;
}
