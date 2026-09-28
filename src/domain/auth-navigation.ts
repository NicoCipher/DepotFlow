const saleReturnPaths = new Set(["/record-sale", "/record-sale/paused"]);

export function safeSignInReturnPath(value: unknown): string {
  return typeof value === "string" && saleReturnPaths.has(value) ? value : "/";
}
