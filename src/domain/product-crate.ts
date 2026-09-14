import { validateCrateType, type CrateAttributes } from "./crate-types.ts";

/** Product-form wording only; identity continues to be the selected record ID. */
export function productCrateLabel(crate: CrateAttributes): string {
  const parts = [
    crate.empty_family,
    crate.pocket_count === null ? null : `${crate.pocket_count}-pocket`,
    crate.name,
    crate.variant,
  ].filter((part): part is string => Boolean(part?.trim()));
  return parts
    .filter(
      (part, index) =>
        parts.findIndex(
          (other) => other.trim().toLowerCase() === part.trim().toLowerCase(),
        ) === index,
    )
    .join(" · ");
}

export function newProductCrate(
  values: Parameters<typeof validateCrateType>[0],
) {
  const variant = values.variant.trim();
  if (!variant) throw new Error("Enter the crate’s variant or form.");
  // The database needs a name; the form can use the supplied form/variant when
  // the owner does not need an additional distinguishing label.
  return validateCrateType({
    ...values,
    name: values.name.trim() || variant,
    variant,
  });
}
