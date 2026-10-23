/** Preserve authoritative denials without redirecting over an unsaved Space editor. */
export class SpaceApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SpaceApiError';
    this.status = status;
  }
}

export async function spacesRequest<T>(
  path = '',
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const guest = guestItemId();
  if (guest && path !== '/' + guest && !path.startsWith('/' + guest + '/'))
    throw new SpaceApiError(404, 'This Space is not available.');
  const response = await fetch((guest ? '/api/guest-spaces' : '/api/spaces') + path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    redirect: 'error',
    signal: options.signal,
    ...(options.body === undefined
      ? {}
      : {
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options.body),
        }),
  });
  if (guest && !options.signal?.aborted && [401, 403, 404].includes(response.status))
    revokeGuestView();
  const result: unknown =
    response.status === 204 ? undefined : await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
        ? result.error
        : 'Could not update this Space. Try again.';
    throw new SpaceApiError(response.status, message);
  }
  if (result === null)
    throw new SpaceApiError(502, 'Spinel returned an incomplete response. Try again.');
  return result as T;
}

export function spaceRequestMessage(error: unknown) {
  return error instanceof SpaceApiError
    ? error.message
    : 'Could not reach Spinel. Reconnect and try again.';
}

export function spaceAccessDenied(error: unknown) {
  return error instanceof SpaceApiError && [401, 403, 404].includes(error.status);
}
import { guestItemId } from './documentAccess.ts';
import { revokeGuestView } from './guestRevocation.ts';
