import { clearDashboardNavigation } from './dashboardNavigation.ts';

export async function itemsRequest<T>(
  path = '',
  method = 'GET',
  body?: unknown,
  verifyCurrent: () => void = () => {},
): Promise<T> {
  const response = await fetch(`/api/items${path}`, {
    method,
    credentials: 'same-origin',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  verifyCurrent();
  if (response.status === 401) {
    clearDashboardNavigation();
    location.assign('/sign-in');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Could not load your items. Try again.');
  return result;
}
