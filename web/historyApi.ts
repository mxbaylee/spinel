import { documentPath } from './documentAccess.ts';

/** Account history keeps the exact Space root separate from its stable child. */
export async function historyRequest<T>(
  id: string,
  path = '',
  method = 'GET',
  body?: unknown,
  spaceId?: string,
): Promise<T> {
  const response = await fetch(`${documentPath(id, spaceId)}/history${path}`, {
    method,
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status === 401) location.assign('/sign-in');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Could not load history. Try again.');
  return result;
}

export function historyHref(id: string, spaceId?: string, checkpoint?: string) {
  const query = new URLSearchParams({ item: id });
  if (spaceId) query.set('space', spaceId);
  if (checkpoint) query.set('version', checkpoint);
  return `/preview?${query}`;
}
