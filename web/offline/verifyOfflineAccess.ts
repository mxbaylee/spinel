import { OfflineConnectionError } from './OfflineAccess.ts';
import type { OfflineScope, AccessProof } from './OfflineAccess.ts';

/** Control-plane metadata only; never cache this response as authorization. */
export async function verifyOfflineAccess(
  scope: OfflineScope,
  signal: AbortSignal,
  origin = location.origin,
  request: typeof fetch = fetch,
): Promise<AccessProof> {
  if (scope.origin !== origin) throw new Error('This download belongs to another instance.');
  let response: Response;
  try {
    response = await request(`${origin}/api/items/${encodeURIComponent(scope.itemId)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'manual',
      signal,
    });
  } catch (error) {
    if (error instanceof TypeError && !signal.aborted)
      throw new OfflineConnectionError('The instance could not be reached.');
    throw error;
  }
  // An HTTP denial or unavailable/malformed server response is not proof that
  // the previously prepared permissions remain valid. Preserve pending work.
  if (!response.ok) throw new Error('The instance did not confirm document access.');
  const data = await response.json();
  const item = data?.item,
    live = data?.live;
  if (
    typeof data?.accountId !== 'string' ||
    typeof item?.id !== 'string' ||
    !['doc', 'sheet'].includes(item?.kind) ||
    !['owner', 'editor', 'viewer'].includes(item?.access) ||
    typeof live?.unitId !== 'string' ||
    typeof live?.restoring !== 'boolean' ||
    typeof live?.sdkVersion !== 'string' ||
    !Number.isSafeInteger(live?.revisionOffset) ||
    live.revisionOffset < 0
  )
    throw new Error('The instance returned incompatible offline access metadata.');
  return {
    accountId: data.accountId,
    itemId: item.id,
    kind: item.kind,
    access: item.access,
    unitId: live.unitId,
    restoring: live.restoring,
    revisionOffset: live.revisionOffset,
    sdkVersion: live.sdkVersion,
  };
}
