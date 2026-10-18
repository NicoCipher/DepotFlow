import { randomUUID } from "node:crypto";
import Link from "next/link";
import { SetupCrateForm } from "@/components/setup-crate-form";
import { ProductImage } from "@/components/product-image";
import { catalogueImageUrl } from "@/domain/product-images";
import { loadOwnerAssortment } from "@/lib/businesses/setup";
import { isUuid } from "@/domain/ids";

export default async function NewDepotDrinksPage({
  params,searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { businessId } = await params;
  if (!isUuid(businessId)) return null;
  const data = await loadOwnerAssortment(businessId);
  if (data.state === "disabled") return (
    <section className="mx-auto max-w-2xl space-y-4">
      <Link href="/businesses" className="quiet-link">← Your depots</Link>
      <h1>Drink setup is not available yet</h1>
      <p className="text-sm text-stone-600">
        No prices, crates or stock were changed. Guided setup is locked
        until the multi-business release has been approved.
      </p>
    </section>
  );

  const search = await searchParams;
  const query = typeof search.q === "string" ? search.q.trim().toLowerCase().slice(0,100) : "";
  const { snapshot } = data;
  const configured = new Set(snapshot.configuredDrinks.map((x) => x.catalogueId));
  const options = snapshot.catalogue.filter((x) =>
    !configured.has(x.id) && (!query || x.name.toLowerCase().includes(query))
  );
  return (
    <section className="mx-auto w-full max-w-2xl space-y-5 pb-8">
      <Link href="/businesses" className="quiet-link">← Your depots</Link>
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
          {data.name} · Setup
        </p>
        <h1 className="text-2xl font-extrabold">Choose drinks and crates</h1>
        <p className="text-sm leading-6 text-stone-600">
          Select what this depot sells. Confirm its exact crate and your
          selling price. Adding a drink does not add stock automatically.
        </p>
      </header>

      <section className="rounded-2xl bg-stone-100 p-4">
        <h2 className="text-sm font-bold text-stone-900">
          {snapshot.configuredDrinks.length} drinks selected · {snapshot.crateTypes.length} crate types
        </h2>
        {snapshot.configuredDrinks.length>0 && (
          <ul className="mt-2 divide-y divide-stone-200 text-sm">
            {snapshot.configuredDrinks.map((p) => (
              <li className="flex justify-between gap-3 py-2" key={p.id}>
                <span className="min-w-0 break-words">{p.name}</span>
                <strong className="shrink-0 tabular-nums">
                  ₦{p.sellingPrice.toLocaleString("en-NG")}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="rounded-2xl border border-stone-200" open={snapshot.crateTypes.length===0}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-bold">
          Physical crates · {snapshot.crateTypes.length} configured
        </summary>
        <div className="space-y-3 px-4 pb-4">
          {snapshot.crateTypes.map((crate) => (
            <p className="text-sm" key={crate.id}>
              {crate.name} · {crate.pockets} pockets · {crate.family}
            </p>
          ))}
          <SetupCrateForm businessId={businessId} crateId={randomUUID()} />
        </div>
      </details>

      <section>
        <h2 className="text-lg font-bold">Select another drink</h2>
        <form method="get" className="mt-3 flex gap-2">
          <label htmlFor="setup-drink-search" className="sr-only">Find a drink</label>
          <input id="setup-drink-search" type="search" name="q" maxLength={100}
            defaultValue={query} className="min-w-0 flex-1" placeholder="Search drinks" />
          <button type="submit" className="secondary">Search</button>
        </form>
        {query && <Link href={`/businesses/${businessId}/drinks`} className="quiet-link mt-2 inline-flex">Clear search</Link>}
        {!snapshot.crateTypes.length && (
          <p className="mt-3 text-sm text-amber-800">
            Set up at least one exact physical crate type before adding drinks.
          </p>
        )}
        <ul className="mt-3 divide-y divide-stone-200 overflow-hidden rounded-2xl border border-stone-200 bg-white">
          {options.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 p-3">
              <span className="flex min-w-0 items-center gap-3">
                <span className="h-16 w-12 shrink-0 overflow-hidden rounded-xl bg-stone-100">
                  <ProductImage src={catalogueImageUrl(item.imagePath)} name={item.name} />
                </span>
                <span className="min-w-0">
                  <strong className="block break-words text-sm">{item.name}</strong>
                  {item.manufacturer && <span className="text-xs text-stone-600">{item.manufacturer}</span>}
                </span>
              </span>
              {snapshot.crateTypes.length>0 ? (
                <Link className="secondary shrink-0" href={`/businesses/${businessId}/drinks/add?catalogue=${item.id}`}>
                  Set up
                </Link>
              ) : <span className="text-xs text-stone-500">Add crate first</span>}
            </li>
          ))}
        </ul>
        {!options.length && <p className="mt-4 text-sm text-stone-600">
          {query ? "No matching unconfigured drinks." : "All listed drinks have been selected."}
        </p>}
      </section>
      <Link href={`/businesses/${businessId}/opening`} className="secondary inline-flex">
        Review opening checklist →
      </Link>
    </section>
  );
}
