export function safeSignInReturnPath(value: unknown): string {
  if (value === "/record-sale" || value === "/record-sale/paused") return value;
  return "/";
}
