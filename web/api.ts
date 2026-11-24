import { maintenanceFetch as fetch } from './maintenanceFetch.ts';
import { clearDashboardNavigation } from './dashboardNavigation.ts';
import { spaceReviewSignInPath } from '../src/shared/spaceReviewRoute.ts';
import { SESSION_REQUEST_DEADLINE_MS } from './offline/deadlines.ts';

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
  options: {
    signal?: AbortSignal;
    accountId?: string;
    onAbandonedChallenge?: (challengeId: string) => void;
  } = {},
): Promise<T> {
  verifyCurrent();
  const checkingSession = path === 'session' && body === undefined;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.accountId) headers['X-Spinel-Account'] = options.accountId;
  const response = await fetch(
    `/api/auth/${path}`,
    body === undefined
      ? {
          signal:
            options.signal ??
            AbortSignal.timeout(checkingSession ? SESSION_REQUEST_DEADLINE_MS : 15_000),
          headers,
        }
      : {
          signal: options.signal,
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        },
  );
  // Consume a dispatched response before retiring its authentication owner.
  // A stale-generation check must not release the transition at headers while
  // an earlier credential request is still settling in the browser.
  const data = await (response.status === 204 ? response.text() : response.json()).catch(
    (failure: unknown) => {
      if (!checkingSession || response.status !== 401) throw failure;
      // Headers already denied this session. A stalled/malformed error body must
      // not turn that authority into an outage that reopens private device data.
      // Still settle the body and fence the owner before handling the denial.
      verifyCurrent();
      return { error: 'Sign in to continue.' };
    },
  );
  try {
    verifyCurrent();
  } catch (failure) {
    // A cancelled options request can still create a server challenge. Supply
    // only its identifier for cleanup, after the complete response has settled;
    // the abandoned options never reach the UI or credential prompt.
    if (
      response.ok &&
      path.endsWith('/options') &&
      typeof data?.challengeId === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(data.challengeId)
    )
      options.onAbandonedChallenge?.(data.challengeId);
    throw failure;
  }
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
      code: data.code,
    });
  return data;
}
