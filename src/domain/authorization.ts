/** Only a verified identity and an explicit successful database owner check pass. */
export function ownerAuthorized(
  userId: string | undefined,
  isOwner: unknown,
  error: unknown,
): boolean {
  return Boolean(userId) && isOwner === true && !error;
}
