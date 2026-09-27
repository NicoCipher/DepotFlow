import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { crateLabel } from "@/domain/crate-types";
import { formatNaira } from "@/domain/products";
import {
  saveBottleDepositPrice,
  saveCrateDepositPrice,
} from "./actions";

export default async function EmptiesRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const supabase = await requireOwner();
  const [crates, cratePrices, bottlePrice] = await Promise.all([
    supabase
      .from("crate_types")
      .select("*")
      .eq("is_legacy", false)
      .order("empty_family", { nullsFirst: false })
      .order("name")
      .order("id"),
    supabase.from("crate_deposit_prices").select("*").order("pocket_count"),
    supabase.from("bottle_deposit_price").select("*").eq("id", 1).maybeSingle(),
  ]);
  if (crates.error || cratePrices.error || bottlePrice.error)
    throw new Error("Could not load empties rules.");

  const params = await searchParams;
  const rates = new Map(
    cratePrices.data.map((rate) => [rate.pocket_count, rate]),
  );
  const pocketCounts = Array.from(
    new Set(
      crates.data
        .map((crate) => crate.pocket_count)
        .filter((value): value is number => value !== null),
    ),
  ).sort((a, b) => a - b);

  return (
    <>
      <h1>Empties Rules</h1>
      <p className="mt-3 text-stone-600">
        Set these once. The system will apply them automatically during sales.
      </p>

      {(params.saved === "bottle" || params.saved === "crate") && (
        <p role="status" className="mt-4 text-emerald-900">
          Deposit price saved.
        </p>
      )}
      {params.error === "price" && (
        <p role="alert" className="mt-4 text-red-800">
          Enter valid deposit prices in ₦50 steps.
        </p>
      )}

      <section className="mt-8 border-t border-stone-300 pt-6">
        <h2 className="text-xl font-semibold">Bottle deposit</h2>
        <p className="mt-2 text-stone-600">
          One price for a returnable bottle, regardless of drink brand.
        </p>
        <form action={saveBottleDepositPrice} className="mt-4">
          <label htmlFor="bottle-deposit">Per bottle</label>
          <div className="mt-2 flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <input
                id="bottle-deposit"
                name="amount"
                type="number"
                inputMode="numeric"
                min="50"
                max="2147483647"
                step="50"
                required
                defaultValue={bottlePrice.data?.amount ?? ""}
                placeholder="Not set"
              />
            </div>
            <button className="secondary shrink-0">Save</button>
          </div>
          {bottlePrice.data && (
            <p className="mt-2 text-sm text-stone-600">
              Current: {formatNaira(bottlePrice.data.amount)}
            </p>
          )}
        </form>
      </section>

      <section className="mt-8 border-t border-stone-300 pt-6">
        <h2 className="text-xl font-semibold">Complete crate deposits</h2>
        <p className="mt-2 text-stone-600">
          A complete crate deposit covers the physical crate and all bottles
          inside it. The price is shared by every crate with the same pocket
          count.
        </p>
        {!pocketCounts.length && (
          <p className="mt-4 text-stone-600">No exact crate types yet.</p>
        )}
        <div className="mt-4 space-y-7">
          {pocketCounts.map((pocketCount) => {
            const rate = rates.get(pocketCount);
            return (
              <form
                action={saveCrateDepositPrice}
                key={pocketCount}
                className="border-t border-stone-200 pt-4"
              >
                <input
                  type="hidden"
                  name="pocket_count"
                  value={pocketCount}
                />
                <p className="font-semibold">{pocketCount}-pocket crate</p>
                <p className="mt-1 text-sm text-stone-600">
                  Same deposit for all {pocketCount}-pocket crate types.
                </p>

                <label
                  className="mt-4 block"
                  htmlFor={`complete-deposit-${pocketCount}`}
                >
                  Complete crate · crate + {pocketCount} bottles
                </label>
                <input
                  id={`complete-deposit-${pocketCount}`}
                  name="complete_amount"
                  type="number"
                  inputMode="numeric"
                  min="50"
                  max="2147483647"
                  step="50"
                  required
                  defaultValue={rate?.complete_crate_amount ?? ""}
                  placeholder="Not set"
                />

                <label
                  className="mt-4 block"
                  htmlFor={`crate-only-deposit-${pocketCount}`}
                >
                  Empty crate only · optional
                </label>
                <input
                  id={`crate-only-deposit-${pocketCount}`}
                  name="crate_only_amount"
                  type="number"
                  inputMode="numeric"
                  min="50"
                  max="2147483647"
                  step="50"
                  defaultValue={rate?.crate_only_amount ?? ""}
                  placeholder="Leave blank until confirmed"
                />
                <p className="mt-2 text-sm text-stone-600">
                  Use this only when all bottles are returned but the physical
                  crate itself is missing.
                </p>

                <button className="secondary mt-4 w-full">Save</button>
              </form>
            );
          })}
        </div>
      </section>

      <section className="mt-8 border-t border-stone-300 pt-6">
        <h2 className="text-xl font-semibold">Crate swaps</h2>
        <p className="mt-2 text-stone-600">
          Deposit prices do not decide which crates can replace each other.
          Set swaps separately for each exact crate type.
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
    </>
  );
}
