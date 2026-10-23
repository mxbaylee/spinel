/** Aggregate Operator requests never display server-provided error text. */
export class AdminRequestError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(status === 401 || status === 403 || status === 404
      ? 'Operator access is unavailable. Sign in again with your Operator account.'
      : 'The request could not be confirmed. Refresh and try again.');
    this.status = status;
  }
}

export async function adminResponse(
  path: string,
  signal: AbortSignal,
  current: () => void,
  body?: unknown,
) {
  const response = await fetch(`/api/admin/${path}`, {
    credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
    ...(body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  });
  // A departed section's denial must not redirect or overwrite its successor.
  current();
  if (!response.ok) throw new AdminRequestError(response.status);
  return response;
}

export const operatorDenied = (error: unknown) => error instanceof AdminRequestError && [401, 403, 404].includes(error.status);
