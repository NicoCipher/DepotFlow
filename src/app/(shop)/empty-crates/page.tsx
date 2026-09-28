import Link from "next/link";
import { SuccessToast } from "@/components/success-toast";
import { PageIntro } from "@/components/page-intro";
import { CrateDisplay } from "@/components/crate-display";
import { crateNeedsSetup, showInDailyEmptyCrates } from "@/domain/crate-types";
import { requireOwner } from "@/lib/auth/owner";
import type { Database } from "@/types/database";

type Crate = Database["public"]["Views"]["known_empty_crates"]["Row"];
export default async function EmptyCratesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; saved?: string; view?: string }>;
}) {
  const supabase = await requireOwner();
  const params = await searchParams;
  const page = Math.max(
    1,
    Math.min(10000, Number.parseInt(params.page ?? "1", 10) || 1),
  );
  const view =
    params.view === "uncounted" || params.view === "available"
      ? params.view
      : "all";
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
  const currentTypes = new Set<string>();
  const unresolved = rows
    .filter(crateNeedsSetup)
    .map((c) => c.crate_type_id)
    .filter((id): id is string => id !== null);
  if (unresolved.length) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("products")
        .select("crate_type_id")
        .in("crate_type_id", unresolved)
        .order("id")
        .range(offset, offset + 999);
      if (error) throw new Error("Could not load crate types.");
      data.forEach((p) => currentTypes.add(p.crate_type_id));
      if (data.length < 1000) break;
    }
  }
  const relevant = rows.filter(
    (c) =>
      c.crate_type_id &&
      showInDailyEmptyCrates(c, currentTypes.has(c.crate_type_id)),
  );
  const regular = relevant.filter((c) => !crateNeedsSetup(c));
  const setup = relevant.filter(crateNeedsSetup);
  const needsCount = regular.filter((c) => c.quantity === null).length;
  const filtered = regular.filter((c) =>
    view === "uncounted"
      ? c.quantity === null
      : view === "available"
        ? (c.quantity ?? 0) > 0
        : true,
  );
  const shown = filtered.slice((page - 1) * 30, page * 30);
  const total = relevant.reduce((sum, c) => sum + (c.quantity ?? 0), 0);
  const pageUrl = (next: number) =>
    `/empty-crates?${new URLSearchParams({ view, page: String(next) })}`;
  return (
    <>
      <div className="mb-4 grid size-12 place-items-center rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-900">
        <svg
          aria-hidden="true"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="M3 8h18v12H3zM3 12h18M8 12v8M16 12v8M6 8V4h4v4M14 8V4h4v4" />
        </svg>
      </div>
      <PageIntro
        eyebrow="Reusable crates"
        title="Empty Crates"
        description="The empty crates physically in your depot. Choose a crate type to update its count."
      />
      {params.saved === "1" && (
        <SuccessToast message="Empty crate count saved." />
      )}
      <div className="mb-6 grid grid-cols-2 divide-x divide-stone-200 rounded-2xl border border-stone-200 bg-white py-4">
        <div className="px-4">
          <p className="text-xs text-stone-600">Recorded empties</p>
          <p className="mt-1 text-2xl font-semibold">
            {total.toLocaleString()}{" "}
            <span className="text-sm font-normal text-stone-500">crates</span>
          </p>
        </div>
        <div className="px-4">
          <p className="text-xs text-stone-600">Need a first count</p>
          <p className="mt-1 text-2xl font-semibold">
            {needsCount}{" "}
            <span className="text-sm font-normal text-stone-500">types</span>
          </p>
        </div>
      </div>
      <nav
        aria-label="Filter empty crates"
        className="mb-5 flex flex-wrap gap-2"
      >
        {(
          [
            ["all", "All types"],
            ["available", "In the depot"],
            ["uncounted", "Not counted"],
          ] as const
        ).map(([value, label]) => (
          <Link
            key={value}
            href={`/empty-crates?view=${value}`}
            aria-current={view === value ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${view === value ? "border-emerald-900 bg-emerald-900 text-white" : "border-stone-200 bg-white text-stone-600"}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {shown.length ? (
        <ul className="space-y-3">
          {shown.map((crate) => (
            <li
              key={crate.crate_type_id}
              className="rounded-xl border border-stone-200 bg-white p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <CrateDisplay crate={crate} />
                </div>
                <div className="shrink-0 text-right">
                  {crate.quantity === null ? (
                    <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
                      Not counted
                    </span>
                  ) : (
                    <>
                      <p className="text-2xl font-semibold tabular-nums">
                        {crate.quantity.toLocaleString()}
                      </p>
                      <p className="text-xs text-stone-500">empty crates</p>
                    </>
                  )}
                </div>
              </div>
              <Link
                className="mt-3 flex min-h-11 items-center justify-between border-t border-stone-100 pt-2 text-sm font-semibold text-emerald-900"
                href={`/empty-crates/count?type=${crate.crate_type_id}`}
                aria-label={`Update empty crate count for ${crate.name}`}
              >
                {crate.quantity === null
                  ? "Record first count"
                  : "Update count"}
                <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed border-stone-300 p-6">
          <h2 className="font-semibold">
            {view === "uncounted"
              ? "All counts are recorded"
              : view === "available"
                ? "No empty crates recorded in the depot"
                : "No crate types here yet"}
          </h2>
          <p className="mt-2 text-sm text-stone-600">
            {view === "all"
              ? "Add a crate type to start recording your empties."
              : "Choose All types to see every crate count."}
          </p>
          {view === "all" && (
            <Link href="/crate-types/new" className="primary mt-4">
              Add crate type
            </Link>
          )}
        </div>
      )}
      <nav aria-label="Crate type pages" className="mt-3 flex justify-between">
        {page > 1 && (
          <Link className="quiet-link" href={pageUrl(page - 1)}>
            ← Previous
          </Link>
        )}
        {filtered.length > page * 30 && (
          <Link className="quiet-link ml-auto" href={pageUrl(page + 1)}>
            Next →
          </Link>
        )}
      </nav>
      {setup.length > 0 && (
        <details className="mt-5 rounded-xl border border-stone-200 p-4">
          <summary className="min-h-11 cursor-pointer font-semibold">
            Older crate records · {setup.length}
          </summary>
          <p className="mb-3 text-sm leading-6 text-stone-600">
            These records are still used by a drink or have a recorded count.
            Review their setup before using them.
          </p>
          <ul className="divide-y divide-stone-200">
            {setup.map((crate) => (
              <li key={crate.crate_type_id} className="py-3">
                <CrateDisplay crate={crate} />
                <p className="mt-1 text-sm text-stone-600">
                  {crate.quantity === null
                    ? "Not counted"
                    : `${crate.quantity} empty crates`}
                </p>
                <Link
                  className="quiet-link inline-block text-sm"
                  href={`/empty-crates/count?type=${crate.crate_type_id}`}
                >
                  Update count
                </Link>
              </li>
            ))}
          </ul>
          <Link className="quiet-link inline-block" href="/crate-types">
            Review crate types
          </Link>
        </details>
      )}
      <div className="mt-6 divide-y divide-stone-200 border-t border-stone-200">
        <Link
          className="flex min-h-14 items-center justify-between py-3 font-medium text-emerald-900"
          href="/activity?type=empties"
        >
          View empties history <span aria-hidden="true">→</span>
        </Link>
        <Link
          className="flex min-h-14 items-center justify-between py-3 text-sm text-stone-600"
          href="/crate-types"
        >
          Manage crate types <span aria-hidden="true">→</span>
        </Link>
      </div>
    </>
  );
}
