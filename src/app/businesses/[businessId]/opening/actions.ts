"use server";

import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/domain/ids";

export type OpeningReviewState = {
  message: string;
  recorded: boolean;
};

/** The confirmation records an immutable REVIEW, never enables business
 * operation. DB-side owner/membership, gate, current snapshot, request UUID,
 * exact name and acknowledgments are verified again atomically.
 */
export async function confirmOpeningReview(
  _previous: OpeningReviewState,
  formData: FormData,
): Promise<OpeningReviewState> {
  const businessId = String(formData.get("business_id") ?? "");
  const requestId = String(formData.get("request_id") ?? "");
  const token = String(formData.get("review_token") ?? "");
  const businessName = String(formData.get("business_name") ?? "").trim();

  if (
    !isUuid(businessId) ||
    !isUuid(requestId) ||
    !/^[0-9a-f]{32}$/.test(token) ||
    businessName.length < 2 ||
    businessName.length > 120
  ) {
    return { message: "The review details have changed. Open the review again.", recorded: false };
  }

  const acknowledged = [
    "stock_checked",
    "customer_debts_checked",
    "refundable_deposits_checked",
    "customer_empties_checked",
    "zero_history_checked",
  ] as const;
  if (acknowledged.some((field) => formData.get(field) !== "on")) {
    return {
      message: "Check all five statements before recording the owner review.",
      recorded: false,
    };
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (!user || authError) {
    return { message: "Sign in as this depot's owner to review its balances.", recorded: false };
  }

  // Don't trust posted business UUID as ownership evidence. Gated listing
  // verifies active membership, and the database confirms again under lock.
  const { data: businesses, error: listError } =
    await supabase.rpc("list_my_businesses_for_setup");
  if (listError || !businesses?.some((business) =>
    business.business_id === businessId &&
    business.business_status === "setup"
  )) {
    return { message: "This depot is not available for owner review.", recorded: false };
  }

  const { data, error } = await supabase.rpc(
    "confirm_business_opening_review",
    {
      p_business_id: businessId,
      p_request_id: requestId,
      p_review_token: token,
      p_confirmed_business_name: businessName,
      p_stock_checked: true,
      p_customer_debts_checked: true,
      p_refundable_deposits_checked: true,
      p_customer_empties_checked: true,
      p_zero_history_checked: true,
    },
  );

  if (error) {
    return {
      message: "The balances may have changed or review is not available. Reload and check before confirming.",
      recorded: false,
    };
  }

  if (
    data && typeof data === "object" && !Array.isArray(data) &&
    data.recorded === true && data.canActivate === false &&
    data.businessId === businessId
  ) {
    return {
      message: "Owner review recorded. Your depot is still in setup; sales are not enabled.",
      recorded: true,
    };
  }
  return {
    message: "Could not verify the saved review. Please reload the opening page.",
    recorded: false,
  };
}
