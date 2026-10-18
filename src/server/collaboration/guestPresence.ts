const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
/** Link rooms carry cursor positions, never profile/custom-event payloads (#72). */
export function safeGuestRoomPresence(payload: unknown, unitId: string, memberId: string) {
  // The public endpoint hook supplies the decoded cursor, without the wire event envelope.
  const data = payload;
  if (
    !record(data) ||
    Object.keys(data).some((key) => !['unitID', 'memberID', 'selection'].includes(key)) ||
    data.unitID !== unitId ||
    data.memberID !== memberId ||
    typeof data.selection !== 'string' ||
    data.selection.length > 160
  )
    return false;
  // Empty means no selection; otherwise accept only native body ranges or sheet-cell addresses.
  return (
    data.selection === '' ||
    /^\d{1,7}:\d{1,7}:\d{1,7}:TEXT::-1$/.test(data.selection) ||
    /^[A-Za-z0-9_-]{1,64}![A-Z]{1,3}[1-9]\d{0,6}(?::[A-Z]{1,3}[1-9]\d{0,6})?$/.test(data.selection)
  );
}
