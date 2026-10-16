/**
 * Web Locks can wait indefinitely if another tab is suspended while holding
 * the same sale-draft key. Never let Review remain "Checking..." forever.
 * A timeout rejects a queued lock acquisition; the callback, once acquired,
 * is synchronous so no partial local-storage write is interrupted.
 */
export async function withBoundedSaleDraftLock(
  locks: Pick<LockManager, "request">,
  key: string,
  write: () => void,
  timeoutMs = 8000,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await locks.request(key, { signal: controller.signal }, () => write());
  } catch (e) {
    if (controller.signal.aborted)
      throw new Error("The sale draft is busy in another tab. Close other DepotFlow tabs and try again.");
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}
