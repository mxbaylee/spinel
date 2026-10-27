import { clearDashboardNavigation } from './dashboardNavigation.ts';
import { spaceReviewSignInPath } from '../src/shared/spaceReviewRoute.ts';

// An assistant connection carries only its opaque transaction ID through sign-in.
export function connectionRequest(): string | null {
  const key =
    location.pathname === '/connect'
      ? 'request'
      : location.pathname === '/sign-in'
        ? 'connect'
        : null;
  const value = key ? new URLSearchParams(location.search).get(key) : null;
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export function signInPath(): string {
  const request = connectionRequest();
  return request
    ? `/sign-in?connect=${encodeURIComponent(request)}`
    : (spaceReviewSignInPath(location) ?? '/sign-in');
}

export async function api<T>(
  path: string,
  body?: unknown,
  verifyCurrent: () => void = () => {},
): Promise<T> {
  verifyCurrent();
  const response = await fetch(
    `/api/auth/${path}`,
    body === undefined
      ? { signal: AbortSignal.timeout(15_000) }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  // Consume a dispatched response before retiring its authentication owner.
  // A stale-generation check must not release the transition at headers while
  // an earlier credential request is still settling in the browser.
  const data = response.status === 204 ? await response.text() : await response.json();
  verifyCurrent();
  if (
    response.status === 401 &&
    !['/sign-in', '/setup', '/recover-admin', '/invite'].includes(location.pathname)
  ) {
    clearDashboardNavigation();
    location.assign(signInPath());
  }
  if (response.status === 204) return undefined as T;
  if (!response.ok)
    throw Object.assign(new Error(data.error ?? 'Something went wrong. Try again.'), {
      status: response.status,
    });
  return data;
}
