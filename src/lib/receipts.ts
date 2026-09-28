export const receiptOrigin = "https://depotflow-bice.vercel.app";
export function receiptUrl(token: string) {
  return `${receiptOrigin}/verify/${token}`;
}
export function methodLabel(method: string) {
  return ({ cash: "Cash", transfer: "Bank transfer", pos: "POS", not_recorded: "Not recorded" } as Record<string, string>)[method] ?? "Not recorded";
}
