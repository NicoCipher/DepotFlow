import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";
import { isProductId } from "@/domain/products";
import { crateLabel } from "@/domain/crate-types";
import { notFound } from "next/navigation";
import { CrateTypeForm } from "@/components/crate-type-form";
import { saveCrateSwapRules } from "@/app/(shop)/crate-types/actions";

export default async function EditCrateTypePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rules?: string }>;
}) {
  const supabase = await requireOwner();
  const { id } = await params;
  if (!isProductId(id)) notFound();

  const [current, candidates, rules] = await Promise.all([
    supabase.from("crate_types").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("crate_types")
      .select("*")
      .eq("is_legacy", false)
      .neq("id", id)
      .order("empty_family", { nullsFirst: false })
      .order("name")
      .order("id"),
    supabase
      .from("crate_swap_rules")
      .select("returned_crate_type_id")
      .eq("owed_crate_type_id", id),
  ]);
  if (current.error || candidates.error || rules.error)
    throw new Error("Could not load crate type.");
  if (!current.data) notFound();

  if (current.data.is_legacy)
    return (
      <>
        <h1>{current.data.name}</h1>
        <p className="mt-3">Needs setup</p>
        <Link className="primary mt-5 w-full" href="/crate-types/new">
          Create exact crate type
        </Link>
        <Link className="quiet-link mt-3" href="/products">
          Choose a crate on each product
        </Link>
      </>
    );

  const selected = new Set(
    rules.data.map((rule) => rule.returned_crate_type_id),
  );
  const ruleStatus = (await searchParams).rules;

  return (
    <>
      <h1>Edit crate type</h1>
      <CrateTypeForm
        id={id}
        editing
        initial={{
          name: current.data.name,
          empty_family: current.data.empty_family ?? "",
          pocket_count: current.data.pocket_count?.toString() ?? "",
          variant: current.data.variant ?? "",
        }}
      />
      <section className="mt-10 border-t border-stone-300 pt-6">
        <h2 className="text-xl font-semibold">Crate swaps</h2>
        <p className="mt-2 text-stone-600">
          Which complete crates can be returned instead of this one? The same
          crate type is always accepted.
        </p>
        {ruleStatus === "saved" && (
          <p role="status" className="mt-3 text-emerald-900">
            Crate swaps saved.
          </p>
        )}
        {ruleStatus === "failed" && (
          <p role="alert" className="mt-3 text-red-800">
            Could not save the crate swaps. Please try again.
          </p>
        )}
        {!candidates.data.length ? (
          <p className="mt-4 text-stone-600">
            Add another exact crate type before setting swaps.
          </p>
        ) : (
          <form
            action={saveCrateSwapRules.bind(null, id)}
            className="mt-5 space-y-4"
          >
            <fieldset className="space-y-3">
              <legend className="sr-only">Allowed replacement crates</legend>
              {candidates.data.map((crate) => (
                <label
                  key={crate.id}
                  className="flex min-h-12 items-center gap-3 border-b border-stone-200 py-3"
                >
                  <input
                    type="checkbox"
                    name="returned_crate_type_id"
                    value={crate.id}
                    defaultChecked={selected.has(crate.id)}
                    className="h-5 w-5 shrink-0"
                  />
                  <span>{crateLabel(crate)}</span>
                </label>
              ))}
            </fieldset>
            <button className="secondary w-full">Save crate swaps</button>
          </form>
        )}
      </section>
    </>
  );
}
