export function isSessionExpiredCode(code?: string): boolean {
  return ["42501", "PGRST301", "401", "403"].includes(code ?? "");
}
