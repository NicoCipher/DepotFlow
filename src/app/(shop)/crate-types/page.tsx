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
  const groups = Map.groupBy(types, (crate) =>
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
                  {crate.is_legacy &&
                    !products.some((product) => product.crate_type_id === crate.id) && (
                      <DeleteCrateType id={crate.id} name={crate.name} />
                    )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      <Link className="quiet-link mt-5" href="/products">
        Back to Products
      </Link>
    </>
  );
}
