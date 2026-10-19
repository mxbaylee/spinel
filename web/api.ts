export async function api<T>(path: string, body?: unknown): Promise<T> {
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
  if (response.status === 401 && !['/sign-in', '/setup', '/invite'].includes(location.pathname))
    location.assign('/sign-in');
  if (response.status === 204) return undefined as T;
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error ?? 'Something went wrong. Try again.'), {
      status: response.status,
    });
  return data;
}
