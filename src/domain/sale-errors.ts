export const saleNetworkMessage =
  "Couldn’t connect. Your sale is still here. Try again.";

export const saleSaveUncertainMessage =
  "Couldn’t confirm whether this sale was saved. Tap Check Sale to verify. Don’t change the sale yet.";

export const saleSessionExpiredMessage =
  "Sign in again to continue this sale.";

export function isSaleSessionExpired(
  hasUser: boolean,
  authError: { status?: number; name?: string; message?: string } | null,
): boolean {
  if (hasUser) return false;
  if (!authError) return true;
  if ([400, 401, 403].includes(authError.status ?? 0)) return true;
  return /session missing|refresh token|jwt.*expired|authsessionmissing/i.test(
    `${authError.name ?? ""} ${authError.message ?? ""}`,
  );
}
