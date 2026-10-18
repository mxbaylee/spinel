export async function itemsRequest<T>(path = '', method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/items${path}`, {
    method,
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (response.status === 401) location.assign('/sign-in');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Could not load your items. Try again.');
  return result;
}
