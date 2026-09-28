import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { getCrateTypes } from "@/lib/crate-types/data";
import { crateNeedsSetup } from "@/domain/crate-types";
import { CrateDisplay } from "@/components/crate-display";
import { DeleteCrateType } from "@/components/delete-crate-type";
export default async function CrateTypesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const supabase = await requireOwner();
  const productsPromise = (async () => {
    const products: {
      id: string;
      name: string;
      size: string | null;
      crate_type_id: string;
    }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("products")
        .select("id,name,size,crate_type_id")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error("Could not load products.");
      products.push(...data);
      if (data.length < 1000) return products;
    }
  })();
  const [types, products] = await Promise.all([
    getCrateTypes(),
    productsPromise,
  ]);
  const currentCrateIds = new Set(products.map((product) => product.crate_type_id));
  const olderRecords = types.filter(
    (crate) => crate.is_legacy && !currentCrateIds.has(crate.id),
  );
  const activeTypes = types.filter((crate) => !olderRecords.includes(crate));
  const groups = Map.groupBy(activeTypes, (crate) =>
    crateNeedsSetup(crate) ? "Needs setup" : crate.empty_family!,
  );
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1>Crate Types</h1>
        <Link href="/crate-types/new" className="primary shrink-0">Add crate type</Link>
      </div>
      {(await searchParams).saved === "1" && (
        <p role="status" className="mt-3 text-emerald-900">
          Crate type saved.
        </p>
      )}
      {!types.length && <p className="mt-6">No crate types yet.</p>}
      {Array.from(groups)
        .sort(([a], [b]) =>
          a === "Needs setup"
            ? 1
            : b === "Needs setup"
              ? -1
              : a.localeCompare(b),
        )
        .map(([family, crates]) => (
          <section key={family} className="mt-8">
            <h2 className="text-xl font-semibold">{family}</h2>
            <ul className="divide-y divide-stone-200">
              {crates.map((crate) => (
                <li key={crate.id} className="py-5">
                  <CrateDisplay crate={crate} includeFamily={false} />
                  <p className="mt-2 text-sm">
                    Products:{" "}
                    {products
                      .filter((p) => p.crate_type_id === crate.id)
                      .map((p) => [p.name, p.size].filter(Boolean).join(" "))
                      .join(", ") || "None yet"}
                  </p>
                  {crate.is_legacy ? (
                    <div className="mt-3">
                      <p className="text-sm text-stone-600">Needs setup</p>
                      <Link
                        className="secondary mt-3"
                        href="/crate-types/new"
                      >
                        Create exact crate type
                      </Link>
                      <Link className="quiet-link mt-2" href="/products">
                        Choose a crate on each product
                      </Link>
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1">
                      <Link
                        className="secondary"
                        href={`/crate-types/${crate.id}/edit`}
                        aria-label={`Edit ${crate.name}`}
                      >
                        Edit
                      </Link>
                      {!products.some((product) => product.crate_type_id === crate.id) && (
                        <DeleteCrateType id={crate.id} name={crate.name} />
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      {olderRecords.length > 0 && (
        <details className="mt-8 border-t border-stone-300 pt-3">
          <summary className="min-h-12 cursor-pointer py-3 font-semibold text-emerald-900">
            Older crate records ({olderRecords.length})
          </summary>
          <p className="mb-2 text-sm text-stone-600">
            No current drinks use these records. They may still belong to past
            stock or sales, so they stay available here for reference.
          </p>
          <ul className="divide-y divide-stone-200">
            {olderRecords.map((crate) => (
              <li key={crate.id} className="py-4">
                <CrateDisplay crate={crate} />
                <p className="mt-2 text-sm text-stone-600">
                  Older records cannot be edited into a new crate type. Create
                  an exact type for current drinks. This record can be deleted
                  only if no stock, sales, counts, or other records use it.
                </p>
                <div className="mt-3">
                  <DeleteCrateType id={crate.id} name={crate.name} />
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
      <Link className="quiet-link mt-5" href="/products">
        Back to Products
      </Link>
    </>
  );
}
