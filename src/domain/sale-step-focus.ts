/** Only focus the step heading when the operator actually changes steps
 * within the same active draft, not while restoring local storage on refresh.
 */
export function shouldFocusSaleStep(
  previous: { step: string; activeId: string | null } | null,
  current: { step: string; activeId: string | null },
): boolean {
  return previous !== null &&
    previous.activeId !== null &&
    previous.activeId === current.activeId &&
    previous.step !== current.step;
}
