import Link from "next/link";
import { SuccessToast } from "@/components/success-toast";
import { PageIntro } from "@/components/page-intro";
import { EmptyCrateInventory } from "@/components/empty-crate-inventory";
import { showInDailyEmptyCrates, crateNeedsSetup } from "@/domain/crate-types";
import { summarizeEmptyCrates } from "@/domain/empty-crate-summary";
import { requireOwner } from "@/lib/auth/owner";
import type { Database } from "@/types/database";

type Crate = Database["public"]["Views"]["known_empty_crates"]["Row"];

export default async function EmptyCratesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const supabase = await requireOwner();
  const params = await searchParams;
  const rows: Crate[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase
      .from("known_empty_crates")
      .select("*")
      .order("name")
      .order("crate_type_id")
      .range(offset, offset + 999);
    if (error) throw new Error("Could not load empty crates.");
    rows.push(...data);
    if (data.length < 1000) break;
  }

  // Older crate identities may still represent real customer debts or physical
  // stock. Keep counted legacy types without guessing how to split them.
  const unresolved = rows.filter(crateNeedsSetup).map(crate => crate.crate_type_id)
    .filter((id): id is string => id !== null);
  const usedByProducts = new Set<string>();
  for (let offset = 0; offset < unresolved.length; offset += 100) {
    const { data, error } = await supabase.from("products")
      .select("crate_type_id")
      .in("crate_type_id", unresolved.slice(offset, offset + 100));
    if (error) throw new Error("Could not load assigned crate types.");
    for (const product of data) usedByProducts.add(product.crate_type_id);
  }
  const relevant = rows.filter(crate => crate.crate_type_id &&
    showInDailyEmptyCrates(crate, usedByProducts.has(crate.crate_type_id!)));
  const summary = summarizeEmptyCrates(relevant);

  return (
    <>
      <PageIntro
        eyebrow="Reusable crates"
        title="Empty Crates"
        description="See the exact empty crates in your depot, grouped by brewery. Different branded crates keep separate counts even when they can replace one another."
      />
      {params.saved === "1" && <SuccessToast message="Empty crate count saved." />}
      <section aria-label="Empty crate stock summary" className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-600">Recorded empty crates</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{summary.countedTotal.toLocaleString()}</p>
          <p className="mt-1 text-xs text-stone-500">{summary.missingCounts
            ? "Known counts only · total is incomplete"
            : "In the depot"}</p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="text-sm text-stone-600">Need first count</p>
          <p className="mt-1 text-3xl font-bold tabular-nums">{summary.missingCounts}</p>
          <p className="mt-1 text-xs text-stone-500">Physical crate types</p>
        </div>
      </section>
      <p className="mb-4 text-sm text-stone-600">
        Brewery subtotals and the depot total are calculated from the individually recorded crate counts, not from drinks sold or customer crates owed.
      </p>
      <EmptyCrateInventory groups={summary.groups} />
      <div className="mt-6 divide-y divide-stone-200 border-t border-stone-200">
        <Link className="flex min-h-14 items-center justify-between py-3 font-medium text-emerald-900"
          href="/activity?type=empties">View empties history <span aria-hidden="true">→</span></Link>
        <Link className="flex min-h-14 items-center justify-between py-3 text-sm text-stone-700"
          href="/crate-types">Manage crate types <span aria-hidden="true">→</span></Link>
      </div>
    </>
  );
}
