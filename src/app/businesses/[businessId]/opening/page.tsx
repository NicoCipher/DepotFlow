import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { OnboardingOpeningReview } from "@/components/onboarding-opening-review";
import { OnboardingOwnerSignoffForm } from "@/components/onboarding-owner-signoff-form";
import { OnboardingActivationForm } from "@/components/onboarding-activation-form";
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
  let savedReviewToken: string | null = null;
  let reviewRecorded = false;
  let reviewStatusAvailable = false;
  let reviewedByCurrentOwner = false;
  let activationReady = false;

  // A recorded review is immutable. Read its server-side status so a page
  // refresh does not present a new request UUID and accidentally attempt a
  // second owner sign-off.
  const { data: reviewStatus, error: reviewStatusError } = await supabase.rpc(
    "business_opening_review_status",
    { p_business_id: matched.business_id },
  );
  if (!reviewStatusError && reviewStatus &&
      typeof reviewStatus === "object" && !Array.isArray(reviewStatus) &&
      reviewStatus.businessId === matched.business_id &&
      reviewStatus.businessStatus === "setup") {
    reviewStatusAvailable = true;
    reviewRecorded = reviewStatus.reviewRecorded === true;
    reviewedByCurrentOwner = reviewStatus.reviewedByCurrentOwner === true;
    if (reviewRecorded && reviewedByCurrentOwner &&
        typeof reviewStatus.reviewToken === "string" &&
        /^[0-9a-f]{32}$/.test(reviewStatus.reviewToken) &&
        typeof reviewStatus.reviewRequestId === "string" &&
        isUuid(reviewStatus.reviewRequestId)) {
      savedReviewToken = reviewStatus.reviewToken;
      activationReady = reviewStatus.canActivate === true;
    }
  }

  // Only an unreviewed, complete snapshot may be presented for owner sign-off.
  // The DB prepares the exact snapshot and token together.
  if (reviewStatusAvailable && !reviewRecorded && canPresentOwnerSignoff(snapshot)) {
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
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={`/businesses/${businessId}/drinks`} className="secondary inline-flex min-h-11 items-center">
          Drinks and crates
        </Link>
        <Link href={`/businesses/${businessId}/stock`} className="secondary inline-flex min-h-11 items-center">
          Starting stock
        </Link>
        <Link href={`/businesses/${businessId}/customers`} className="secondary inline-flex min-h-11 items-center">
          Customers
        </Link>
      </div>
      <OnboardingOpeningReview snapshot={snapshot} />
      {!reviewStatusAvailable ? (
        <p className="mt-4 max-w-2xl rounded-xl border border-stone-200 p-3 text-sm text-stone-600">
          Owner review status cannot be verified right now. Sign-off and activation are paused to prevent a duplicate or stale review.
        </p>
      ) : !reviewRecorded && signoffToken && snapshot.profile?.name ? (
        <OnboardingOwnerSignoffForm
          businessId={matched.business_id}
          businessName={snapshot.profile.name}
          reviewToken={signoffToken}
          requestId={crypto.randomUUID()}
        />
      ) : reviewRecorded && reviewedByCurrentOwner && activationReady && savedReviewToken ? (
        <OnboardingActivationForm
          businessId={matched.business_id}
          reviewToken={savedReviewToken}
          requestId={crypto.randomUUID()}
        />
      ) : reviewRecorded && !reviewedByCurrentOwner ? (
        <p className="mt-4 max-w-2xl rounded-xl border border-stone-200 p-3 text-sm text-stone-600">
          The owner review was recorded by another owner. Only the owner who confirmed it can complete this depot's activation.
        </p>
      ) : reviewRecorded ? (
        <p className="mt-4 max-w-2xl rounded-xl border border-stone-200 p-3 text-sm text-stone-600">
          Owner review recorded. Final activation remains locked until its
          independent release gate is enabled and the live opening records still match.
        </p>
      ) : (
        <p className="mt-4 max-w-2xl rounded-xl border border-stone-200 p-3 text-sm text-stone-600">
          Owner confirmation is not enabled for this depot yet. No business
          activation or sales are permitted from this screen.
        </p>
      )}
    </>
  );
}
