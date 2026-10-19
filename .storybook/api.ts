// Stand-in API responses for stories, keyed by `METHOD /path` without the query.
// A value is the JSON body of a 200 response unless it is one of these helpers.
const marker = Symbol('story reply');
type Reply = { [marker]: true; status: number; body?: unknown; pending?: boolean };
export type ApiMock = Record<string, unknown>;

/** A response that never arrives, for loading states. */
export const pending = (): Reply => ({ [marker]: true, status: 0, pending: true });
/** A failed request with Spinel's `{ error }` body. */
export const failure = (error: string, status = 400): Reply => ({
  [marker]: true,
  status,
  body: { error },
});

export function mockFetch(mock: ApiMock = {}): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      location.href,
    );
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${url.pathname}`;
    const value = Object.hasOwn(mock, key)
      ? mock[key]
      : failure(`No story response for ${key}.`, 404);
    const reply = (
      value && typeof value === 'object' && marker in value ? value : { status: 200, body: value }
    ) as Reply;
    if (reply.pending) return new Promise<Response>(() => {});
    if (reply.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}
