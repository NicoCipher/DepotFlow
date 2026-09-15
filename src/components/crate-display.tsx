import { crateDescription, type CrateAttributes } from "@/domain/crate-types";
export function CrateDisplay({
  crate,
  includeFamily = true,
}: {
  crate: CrateAttributes;
  includeFamily?: boolean;
}) {
  const description = crateDescription(crate, includeFamily);
  return (
    <>
      <span className="block break-words font-semibold">{crate.name}</span>
      {description && (
        <span className="block break-words text-sm font-normal text-stone-600">
          {description}
        </span>
      )}
    </>
  );
}
