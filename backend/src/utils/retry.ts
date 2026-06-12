/**
 * retry.ts — pure retry/backoff/dead-letter policy.
 *
 * Kept dependency-free so it can be unit-tested in isolation. The campaign
 * pipeline uses this to decide, after a task fails, whether to retry (and how
 * long to wait) or to dead-letter the lead.
 */

export const MAX_LEAD_ATTEMPTS = 5;

const BASE_BACKOFF_SECONDS = 3600;        // 1h
const MAX_BACKOFF_SECONDS = 24 * 3600;    // cap at 24h

/**
 * Exponential backoff with a hard cap. `failCount` is the number of failures
 * SO FAR including the one that just happened (1-based).
 *   1 → 1h, 2 → 2h, 3 → 4h, 4 → 8h, 5 → 16h, 6+ → 24h (capped)
 */
export function backoffSeconds(failCount: number): number {
  const n = Math.max(1, Math.floor(failCount));
  const raw = BASE_BACKOFF_SECONDS * Math.pow(2, n - 1);
  return Math.min(raw, MAX_BACKOFF_SECONDS);
}

/** True once a lead has failed too many times and should be dead-lettered. */
export function isDeadLettered(failCount: number): boolean {
  return failCount >= MAX_LEAD_ATTEMPTS;
}

/**
 * Decide what to do after a failure.
 * Returns either a retry with a delay, or a dead-letter verdict.
 */
export function nextFailureAction(failCount: number):
  | { action: 'retry'; delaySeconds: number }
  | { action: 'dead_letter' } {
  if (isDeadLettered(failCount)) return { action: 'dead_letter' };
  return { action: 'retry', delaySeconds: backoffSeconds(failCount) };
}
