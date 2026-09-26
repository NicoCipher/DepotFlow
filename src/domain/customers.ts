export type CustomerValues = {
  name: string;
  phone: string;
  business_name: string;
  address: string;
};
export type CustomerErrors = Partial<Record<keyof CustomerValues, string>>;
export type CustomerFormState = {
  values: CustomerValues;
  errors: CustomerErrors;
  message?: string;
  createdId?: string;
};
export const emptyCustomer: CustomerValues = {
  name: "",
  phone: "",
  business_name: "",
  address: "",
};
export const isCustomerId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

export function normalizePhone(value: string): string {
  const compact = value.replace(/[\s().-]/g, "");
  if (/^0\d{10}$/.test(compact)) return `+234${compact.slice(1)}`;
  if (/^234\d{10}$/.test(compact)) return `+${compact}`;
  return compact;
}
export function validateCustomer(values: CustomerValues) {
  const data = {
    name: values.name.trim().replace(/\s+/g, " "),
    phone: normalizePhone(values.phone),
    business_name: values.business_name.trim().replace(/\s+/g, " ") || null,
    address: values.address.trim() || null,
  };
  const errors: CustomerErrors = {};
  if (!data.name || data.name.length > 120)
    errors.name = "Enter a name of up to 120 characters.";
  if (!/^\+?\d{7,15}$/.test(data.phone) || values.phone.length > 40)
    errors.phone = "Enter a valid phone number.";
  if ((data.business_name?.length ?? 0) > 160)
    errors.business_name = "Use up to 160 characters.";
  if ((data.address?.length ?? 0) > 500)
    errors.address = "Use up to 500 characters.";
  return { data, errors, valid: Object.keys(errors).length === 0 };
}

/** Quote PostgREST values and escape LIKE wildcards, including its '*' alias. */
function searchPattern(value: string) {
  const literal = value.replace(/[\\%_*]/g, "\\$&");
  return JSON.stringify(`%${literal}%`);
}
export function customerSearchFilter(query: string): string {
  const term = query.trim().replace(/\s+/g, " ").slice(0, 120);
  const normalized = normalizePhone(term);
  const phone = /^0\d+$/.test(normalized)
    ? `+234${normalized.slice(1)}`
    : normalized;
  return `name.ilike.${searchPattern(term)},phone.ilike.${searchPattern(phone)}`;
}

/** Crate and bottle obligations are independent counts, not a single quantity to split. */
export function formatEmptiesOwed(crates: number, bottles: number): string {
  const parts: string[] = [];
  if (crates) parts.push(`${crates} ${crates === 1 ? "crate" : "crates"}`);
  if (bottles) parts.push(`${bottles} ${bottles === 1 ? "bottle" : "bottles"}`);
  return parts.length ? parts.join(" + ") : "None";
}

export function sameCustomerDetails(
  a: ReturnType<typeof validateCustomer>["data"],
  b: ReturnType<typeof validateCustomer>["data"],
): boolean {
  return (
    a.name === b.name &&
    a.phone === b.phone &&
    a.business_name === b.business_name &&
    a.address === b.address
  );
}
