import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OnboardingOpeningReview } from "@/components/onboarding-opening-review";
import type { OpeningReadinessSnapshot } from "@/domain/opening-readiness";
import { isUuid } from "@/domain/ids";
import { createClient } from "@/lib/supabase/server";

/** Pre-operational owner review ONLY; no live settlement, activation, or
 * opening-write actions. The requested business is re-verified in the
 * owner's gated list on EVERY request, never via a cookie/localStorage role.
 */
export default async function BusinessOpeningReviewPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  if (!isUuid(businessId)) notFound();

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (!user || authError) redirect("/sign-in?next=%2Fbusinesses");

  const { data: businesses, error: listError } =
    await supabase.rpc("list_my_businesses_for_setup");
  if (listError) {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <h1>Opening review is unavailable</h1>
        <p className="text-sm text-stone-600">
          Multi-business setup has not been enabled for this account.
          No existing shop records have been changed.
        </p>
        <Link href="/businesses" className="quiet-link">Business accounts</Link>
      </div>
    );
  }

  const matched = businesses?.find(
    (business) =>
      business.business_id.toLowerCase() === businessId.toLowerCase() &&
      business.business_status === "setup",
  );
  if (!matched) notFound();

  const { data: rawSnapshot, error: previewError } = await supabase.rpc(
    "preview_business_opening_readiness",
    { p_business_id: matched.business_id },
  );

  if (previewError || !rawSnapshot) {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <Link href="/businesses" className="quiet-link">← Your depots</Link>
        <h1 className="text-2xl font-bold">Opening review is not enabled</h1>
        <p className="text-sm leading-6 text-stone-600">
          {matched.business_name} remains in setup. You cannot start operations
          or submit financial opening balances here until the guarded
          multi-business release is approved.
        </p>
      </div>
    );
  }

  // The DB function is an owner-verified JSONB result with a fixed shape.
  // Reject a malformed reply before rendering or trusting its business ID.
  if (
    typeof rawSnapshot !== "object" || Array.isArray(rawSnapshot) ||
    rawSnapshot.businessId !== matched.business_id ||
    typeof rawSnapshot.technicalChecklistComplete !== "boolean" ||
    rawSnapshot.canActivate !== false ||
    !rawSnapshot.physicalOpening || !rawSnapshot.customerOpening ||
    !rawSnapshot.configured
  ) {
    throw new Error("Could not verify this business opening review.");
  }
  const snapshot = rawSnapshot as unknown as OpeningReadinessSnapshot;
  return (
    <>
      <Link href="/businesses" className="quiet-link mb-4 inline-flex self-start">
        ← Your depots
      </Link>
      <OnboardingOpeningReview snapshot={snapshot} />
    </>
  );
}
