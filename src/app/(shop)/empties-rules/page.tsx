import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { crateLabel } from "@/domain/crate-types";
import { formatNaira } from "@/domain/products";
import { saveDepositPrice } from "./actions";

export default async function EmptiesRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const supabase = await requireOwner();
  const [crates, cratePrices, bottlePrices, products] = await Promise.all([
    supabase
      .from("crate_types")
      .select("*")
      .eq("is_legacy", false)
      .order("empty_family", { nullsFirst: false })
      .order("name")
      .order("id"),
    supabase.from("crate_deposit_prices").select("*"),
    supabase.from("bottle_deposit_prices").select("*"),
    supabase
      .from("products")
      .select("bottle_type")
      .eq("bottles_returnable", true)
      .not("bottle_type", "is", null)
      .order("bottle_type"),
  ]);
  if (crates.error || cratePrices.error || bottlePrices.error || products.error)
    throw new Error("Could not load empties rules.");

  const params = await searchParams;
  const cratePrice = new Map(
    cratePrices.data.map((price) => [price.crate_type_id, price.amount]),
  );
  const bottlePrice = new Map(
    bottlePrices.data.map((price) => [price.bottle_type, price.amount]),
  );
  const bottleTypes = Array.from(
    new Set(
      products.data
        .map((product) => product.bottle_type)
        .filter((value): value is string => Boolean(value)),
    ),
  );

  return (
    <>
      <h1>Empties Rules</h1>
      <p className="mt-3 text-stone-600">
        Set these once. DepotFlow will use them automatically during sales.
      </p>
      {params.saved === "price" && (
        <p role="status" className="mt-4 text-emerald-900">
          Deposit price saved.
        </p>
      )}
      {params.error === "price" && (
        <p role="alert" className="mt-4 text-red-800">
          Enter a valid deposit price in ₦50 steps.
        </p>
      )}

      <section className="mt-8 border-t border-stone-300 pt-6">
        <h2 className="text-xl font-semibold">Crate swaps</h2>
        <p className="mt-2 text-stone-600">
          Choose a crate type to set which complete crates may replace it.
        </p>
        <ul className="mt-4 divide-y divide-stone-200">
          {crates.data.map((crate) => (
            <li key={crate.id}>
              <Link
                href={`/crate-types/${crate.id}/edit`}
                className="flex min-h-16 items-center justify-between gap-4 py-3"
              >
                <span>{crateLabel(crate)}</span>
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8 border-t border-stone-300 pt-6">
        <h2 className="text-xl font-semibold">Crate deposit prices</h2>
        <p className="mt-2 text-stone-600">
          Set the current amount charged when a crate is missing.
        </p>
        {!crates.data.length && (
          <p className="mt-4 text-stone-600">No exact crate types yet.</p>
        )}
        <div className="mt-4 space-y-6">
          {crates.data.map((crate) => {
            const amount = cratePrice.get(crate.id);
            return (
              <form
                action={saveDepositPrice}
                key={crate.id}
                className="border-t border-stone-200 pt-4"
              >
                <input type="hidden" name="kind" value="crate" />
                <input type="hidden" name="key" value={crate.id} />
                <p className="font-semibold">{crateLabel(crate)}</p>
                <label
                  className="mt-3 block"
                  htmlFor={`crate-deposit-${crate.id}`}
                >
                  Deposit amount
                </label>
                <div className="mt-2 flex items-end gap-3">
                  <div className="min-w-0 flex-1">
                    <input
                      id={`crate-deposit-${crate.id}`}
                      name="amount"
                      type="number"
                      inputMode="numeric"
                      min="50"
                      max="2147483647"
                      step="50"
                      required
                      defaultValue={amount ?? ""}
                      placeholder="Not set"
                    />
                  </div>
                  <button className="secondary shrink-0">Save</button>
                </div>
                {amount !== undefined && (
                  <p className="mt-2 text-sm text-stone-600">
                    Current: {formatNaira(amount)}
                  </p>
                )}
              </form>
            );
          })}
        </div>
      </section>

      <section className="mt-8 border-t border-stone-300 pt-6">
        <h2 className="text-xl font-semibold">Bottle deposit prices</h2>
        <p className="mt-2 text-stone-600">
          Set the current amount charged for each missing returnable bottle.
        </p>
        {!bottleTypes.length && (
          <p className="mt-4 text-stone-600">
            No returnable bottle types are in use yet.
          </p>
        )}
        <div className="mt-4 space-y-6">
          {bottleTypes.map((bottleType) => {
            const amount = bottlePrice.get(bottleType);
            return (
              <form
                action={saveDepositPrice}
                key={bottleType}
                className="border-t border-stone-200 pt-4"
              >
                <input type="hidden" name="kind" value="bottle" />
                <input type="hidden" name="key" value={bottleType} />
                <p className="font-semibold">{bottleType}</p>
                <label
                  className="mt-3 block"
                  htmlFor={`bottle-deposit-${bottleType}`}
                >
                  Deposit per bottle
                </label>
                <div className="mt-2 flex items-end gap-3">
                  <div className="min-w-0 flex-1">
                    <input
                      id={`bottle-deposit-${bottleType}`}
                      name="amount"
                      type="number"
                      inputMode="numeric"
                      min="50"
                      max="2147483647"
                      step="50"
                      required
                      defaultValue={amount ?? ""}
                      placeholder="Not set"
                    />
                  </div>
                  <button className="secondary shrink-0">Save</button>
                </div>
                {amount !== undefined && (
                  <p className="mt-2 text-sm text-stone-600">
                    Current: {formatNaira(amount)}
                  </p>
                )}
              </form>
            );
          })}
        </div>
      </section>
    </>
  );
}
