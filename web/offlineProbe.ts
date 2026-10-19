import type { Univer } from '@univerjs/core';
import { ILocalCacheService } from '@univerjs-pro/collaboration-client';
import type { IUnitCacheData } from '@univerjs-pro/collaboration-client';

type RecoveryProbe = {
  beforeLoad: IUnitCacheData | null | undefined;
  read: () => Promise<IUnitCacheData | null | undefined>;
};
declare global {
  interface Window {
    __spinelRecoveryProbe?: RecoveryProbe;
  }
}

/** Temporary fixture instrumentation through the public cache read API only. */
export async function observeOfflineRecovery(univer: Univer, unitId: string, userId: string) {
  if (
    !import.meta.env.SPINEL_RECOVERY_PROBE ||
    location.origin !== 'https://localhost:3103' ||
    new URLSearchParams(location.search).get('offline-probe') !== '1'
  )
    return () => {};
  const cache = univer.__getInjector().get(ILocalCacheService);
  const read = async () => structuredClone((await cache.loadOfflineData(unitId, userId)) ?? null);
  const probe = { beforeLoad: await read(), read };
  window.__spinelRecoveryProbe = probe;
  return () => {
    if (window.__spinelRecoveryProbe === probe) delete window.__spinelRecoveryProbe;
  };
}
