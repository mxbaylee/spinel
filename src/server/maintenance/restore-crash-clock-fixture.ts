/** Test-only wall-clock offset for restarting beyond a persisted authority deadline.
 * Never shorten an earlier virtual advance when another cold attempt expires. */
export function expiredRestoreClockOffset(deadline: number, wallNow: number, previousOffset = 0) {
  return Math.max(previousOffset, deadline + 1 - wallNow);
}
