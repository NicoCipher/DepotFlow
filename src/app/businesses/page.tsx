import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Independent multi-business entry, deliberately outside the legacy shop
 * route group. This page may show only verified owner memberships returned
 * by the gated, security-definer listing function.
 */
export default async function ChooseBusinessPage() {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) redirect("/sign-in?next=%2Fbusinesses");

  const { data, error } = await supabase.rpc("list_my_businesses_for_setup");
  // Registration is independently gated. Absence of a grant is a normal
  // pre-release state, never a reason to show a misleading enabled button.
  const registration = error
    ? null
    : await supabase.rpc("can_register_business");
  const canCreate = !registration?.error && registration?.data === true;
  if (error) {
    return (
      <section className="mx-auto max-w-xl space-y-4">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
          DepotFlow · Business accounts
        </p>
        <h1>Business setup is not available yet</h1>
        <p className="text-sm leading-6 text-stone-600">
          Your account is signed in, but multi-business onboarding has not
          been enabled. This does not change your existing shop or its records.
        </p>
        <Link href="/" className="quiet-link">Return to DepotFlow</Link>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-2xl space-y-5 pb-8">
      <header className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">
          DepotFlow · Business accounts
        </p>
        <h1 className="text-2xl font-extrabold">Choose your depot</h1>
        <p className="text-sm leading-6 text-stone-600">
          Each depot has its own products, stock, customers, debts and records.
          Select the business you own before reviewing its opening balances.
        </p>
      </header>

      {canCreate && (
        <Link
          href="/businesses/new"
          className="primary inline-flex min-h-12 w-full items-center justify-center sm:w-auto"
        >
          Register a new depot
        </Link>
      )}
      {!data?.length ? (
        <div className="rounded-2xl border border-dashed border-stone-300 p-5">
          <h2 className="font-bold">No businesses linked yet</h2>
          <p className="mt-2 text-sm text-stone-600">
            {canCreate
              ? "Create your first depot to begin a separate setup."
              : "No depot is linked to this account yet. Registration may be disabled or your email may need verification."}
            Your existing shop has not been converted or copied.
          </p>
        </div>
      ) : (
        <ul className="space-y-3" aria-label="Your verified business accounts">
          {data.map((business) => (
            <li key={business.business_id}>
              {business.business_status === "setup" ? (
                <Link
                  href={`/businesses/${business.business_id}/drinks`}
                  className="flex min-h-20 items-center justify-between gap-4 rounded-2xl border border-stone-200 bg-white p-4 transition hover:border-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-800"
                >
                  <span className="min-w-0">
                    <strong className="block break-words text-base text-stone-950">
                      {business.business_name}
                    </strong>
                    <span className="mt-1 block text-xs text-stone-600">
                      Setup in progress · Owner
                    </span>
                  </span>
                  <span aria-hidden="true" className="shrink-0 text-emerald-900">→</span>
                </Link>
              ) : (
                <div className="rounded-2xl border border-stone-200 bg-stone-100 p-4">
                  <strong className="block break-words text-base text-stone-950">
                    {business.business_name}
                  </strong>
                  <p className="mt-1 text-xs text-stone-600">
                    Existing business · Operations access requires the later tenant checkout release
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-5 text-stone-600">
        Selecting a depot does not switch the legacy shop or authorize sales.
        New-business operation and staff access remain disabled.
      </p>
    </section>
  );
}
