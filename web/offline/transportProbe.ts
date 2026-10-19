import { PreparedNetworkCondition } from './PreparedNetworkCondition.ts';
import type { Univer } from '@univerjs/core';
import {
  ICollaborationSocketService,
  INetworkConditionService,
} from '@univerjs-pro/collaboration-client';
import type { OfflineScope } from './OfflineAccess.ts';
import { OfflineAccess } from './OfflineAccess.ts';
import { verifyOfflineAccess } from './verifyOfflineAccess.ts';

declare global {
  interface Window {
    __spinelTransportProbe?: {
      lock(): void;
      outage(): void;
      validate(): Promise<boolean>;
      connect(): Promise<boolean>;
      state(): string;
      network(): { prepared: boolean; online: boolean };
    };
  }
}
/** Bounded real-SDK fixture, never enabled by a normal deployment/query alone. */
export async function prepareTransportProbe(itemId: string) {
  if (
    !import.meta.env.SPINEL_RECOVERY_PROBE ||
    location.origin !== 'https://localhost:3103' ||
    new URLSearchParams(location.search).get('transport-probe') !== '1'
  )
    return undefined;
  const response = await fetch(`/api/items/${encodeURIComponent(itemId)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Transport probe scope unavailable.');
  const data = await response.json();
  const scope: OfflineScope = {
    origin: location.origin,
    accountId: data.accountId,
    itemId,
    unitId: data.live.unitId,
    kind: data.item.kind,
    access: data.item.access,
    sdkVersion: data.live.sdkVersion,
    schema: 1,
    revisionOffset: data.live.revisionOffset,
  };
  const access = new OfflineAccess(scope, verifyOfflineAccess);
  access.completeRecovery();
  if (!(await access.validate())) throw new Error('Transport probe access unavailable.');
  return access;
}
export function observeTransportProbe(univer: Univer, access?: OfflineAccess) {
  if (!access) return () => {};
  const service = univer.__getInjector().get(ICollaborationSocketService);
  const condition = univer.__getInjector().get(INetworkConditionService);
  const probe = {
    lock: () => access.lock('Fixture account lock.'),
    outage: () => access.networkLost(),
    validate: () => access.validate(),
    state: () => access.state.phase,
    network: () => ({
      prepared: condition instanceof PreparedNetworkCondition,
      online: condition.online,
    }),
    async connect() {
      try {
        const socket = await service.createSocket(
          location.origin.replace(/^http/, 'ws') + '/universer-api/comb/connect',
        );
        if (!socket) return false;
        // Keep it alive: the native-browser probe must demonstrate that a later
        // lock closes an established socket, not merely refuse new creation.
        return true;
      } catch {
        return false;
      }
    },
  };
  window.__spinelTransportProbe = probe;
  return () => {
    access.dispose();
    if (window.__spinelTransportProbe === probe) delete window.__spinelTransportProbe;
  };
}
