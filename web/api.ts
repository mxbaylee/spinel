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
  const response = await fetch(
    `/api/auth/${path}`,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  verifyCurrent();
  if (
    response.status === 401 &&
    !['/sign-in', '/setup', '/recover-admin', '/invite'].includes(location.pathname)
  )
    location.assign(signInPath());
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  verifyCurrent();
  if (!response.ok)
    throw Object.assign(new Error(data.error ?? 'Something went wrong. Try again.'), {
      status: response.status,
    });
  return data;
}
