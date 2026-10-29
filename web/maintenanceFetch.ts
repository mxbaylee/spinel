import { getMaintenanceStatus, refreshMaintenanceStatus } from './maintenanceState.ts';

const header = 'X-Spinel-Epoch';
let tabEpoch: string | undefined;

/** A mounted tab never silently adopts authority for a later recovery epoch. */
export function capturedMaintenanceEpoch() {
  const status = getMaintenanceStatus();
  if (tabEpoch === undefined && status) tabEpoch = status.available ? status.epoch : '';
  return tabEpoch;
}

/** Explicit request wrapper; offline callers supply their durable base epoch. */
export async function maintenanceFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const address = new URL(input instanceof Request ? input.url : input.toString(), location.origin);
  if (address.origin !== location.origin) return fetch(input, init);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  let epoch = capturedMaintenanceEpoch();
  const method = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (epoch === undefined && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !headers.has(header)) {
    await refreshMaintenanceStatus();
    epoch = capturedMaintenanceEpoch();
  }
  if (!headers.has(header) && epoch !== undefined) headers.set(header, epoch);
  const response = await fetch(input, { ...init, headers });
  // First-start reads can complete before the status poll. The response carries
  // its admission epoch, not a later epoch observed after the work finished.
  if (tabEpoch === undefined && response.ok && response.headers.has(header))
    tabEpoch = response.headers.get(header)!;
  return response;
}
