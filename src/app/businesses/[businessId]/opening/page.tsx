import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OnboardingOpeningReview } from "@/components/onboarding-opening-review";
import { OnboardingOwnerSignoffForm } from "@/components/onboarding-owner-signoff-form";
import { canPresentOwnerSignoff, type OpeningReadinessSnapshot } from "@/domain/opening-readiness";
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
  let snapshot = rawSnapshot as unknown as OpeningReadinessSnapshot;
  let signoffToken: string | null = null;

  // A separate and currently DISABLED gate controls whether an owner can
  // sign anything. Only show the form if that gate returns a server token.
  // Display the EXACT prepared snapshot paired with the token, never a
  // separate potentially outdated preview from an earlier database read.
  if (canPresentOwnerSignoff(snapshot)) {
    const { data: prepared, error: prepareError } = await supabase.rpc(
      "prepare_business_opening_review",
      { p_business_id: matched.business_id },
    );
    if (
      !prepareError &&
      prepared && typeof prepared === "object" && !Array.isArray(prepared) &&
      typeof prepared.reviewToken === "string" &&
      /^[0-9a-f]{32}$/.test(prepared.reviewToken) &&
      prepared.canActivate === false &&
      prepared.snapshot && typeof prepared.snapshot === "object" &&
      !Array.isArray(prepared.snapshot) &&
      prepared.snapshot.businessId === matched.business_id &&
      prepared.snapshot.canActivate === false
    ) {
      const current = prepared.snapshot as unknown as OpeningReadinessSnapshot;
      snapshot = current;
      if (canPresentOwnerSignoff(current)) signoffToken = prepared.reviewToken;
    }
  }

  return (
    <>
      <Link href="/businesses" className="quiet-link mb-4 inline-flex self-start">
        ← Your depots
      </Link>
      <div className="mb-4"><Link href={`/businesses/${businessId}/drinks`} className="secondary inline-flex">Review drinks and crate setup</Link></div>
      <OnboardingOpeningReview snapshot={snapshot} />
      {signoffToken && snapshot.profile?.name ? (
        <OnboardingOwnerSignoffForm
          businessId={matched.business_id}
          businessName={snapshot.profile.name}
          reviewToken={signoffToken}
          requestId={crypto.randomUUID()}
        />
      ) : (
        <p className="mt-4 max-w-2xl rounded-xl border border-stone-200 p-3 text-sm text-stone-600">
          Owner confirmation is not enabled for this depot yet. No business
          activation or sales are permitted from this screen.
        </p>
      )}
    </>
  );
}
