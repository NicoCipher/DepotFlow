import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SetupDrinkForm } from "@/components/setup-drink-form";
import { loadOwnerAssortment } from "@/lib/businesses/setup";
import { isUuid } from "@/domain/ids";

export default async function AddDepotDrinkPage({
  params, searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ catalogue?: string }>;
}) {
  const { businessId } = await params;
  const { catalogue } = await searchParams;
  if (!isUuid(businessId) || typeof catalogue !== "string" ||
      !isUuid(catalogue)) notFound();
  const result = await loadOwnerAssortment(businessId);
  if (result.state !== "ready") return (
    <section className="mx-auto max-w-xl space-y-3">
      <Link href="/businesses" className="quiet-link">← Your depots</Link>
      <h1>Drink setup is not available</h1>
      <p className="text-sm text-stone-600">
        {result.state === "incomplete"
          ? "The drink catalogue is incomplete. No prices or products can be configured from a partial list."
          : "This rollout is disabled. No stock, prices or drinks were changed."}
      </p>
    </section>
  );
  const { snapshot } = result;
  const drink = snapshot.catalogue.find((x) => x.id === catalogue);
  if (!drink) notFound();
  const already = snapshot.configuredDrinks.some((x) => x.catalogueId === catalogue);
  return (
    <section className="mx-auto w-full max-w-xl space-y-5 pb-8">
      <Link href={`/businesses/${businessId}/drinks`} className="quiet-link">
        ← Drinks and crates
      </Link>
      <header>
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
          {result.name} · Drink setup
        </p>
        <h1 className="mt-2 text-2xl font-extrabold">{drink.name}</h1>
        <p className="mt-1 text-sm leading-6 text-stone-600">
          Choose its exact physical crate and your selling prices. Each depot
          configures its own prices, even when other depots sell this drink.
        </p>
      </header>
      {already ? (
        <div className="rounded-2xl bg-stone-100 p-4">
          <h2 className="font-bold">Already configured for this depot</h2>
          <p className="mt-1 text-sm text-stone-600">
            Adding it again would risk duplicate pricing and stock records.
          </p>
        </div>
      ) : snapshot.crateTypes.length===0 ? (
        <div className="rounded-2xl bg-stone-100 p-4 text-sm">
          Set up its exact physical crate type before adding this drink.
        </div>
      ) : (
        <SetupDrinkForm businessId={businessId} catalogueId={drink.id}
          productId={randomUUID()} crates={snapshot.crateTypes} />
      )}
      <Link href={`/businesses/${businessId}/drinks`} className="quiet-link">
        Back to available drinks
      </Link>
    </section>
  );
}
