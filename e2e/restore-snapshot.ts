import type { APIRequestContext } from '@playwright/test';

/** Observe restore state without retaining an idle socket across native UI work. */
export async function readRestoreSnapshot(request: APIRequestContext, path: string) {
  const response = await request.get(path, { headers: { Connection: 'close' } });
  if (!response.ok())
    throw new Error(`Restore snapshot observation failed: HTTP ${response.status()}.`);
  return response.json();
}
