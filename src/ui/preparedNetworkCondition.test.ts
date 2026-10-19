import { expect, test } from 'vitest';
import { OfflineAccess } from '../../web/offline/OfflineAccess.ts';
import type { AccessProof } from '../../web/offline/OfflineAccess.ts';
import { PreparedNetworkCondition } from '../../web/offline/PreparedNetworkCondition.ts';

function fixture(access: 'owner' | 'viewer' = 'owner') {
  const scope = {
    origin: 'https://spinel.example',
    accountId: 'owner',
    itemId: 'item',
    unitId: 'unit',
    kind: 'sheet' as const,
    access,
    sdkVersion: '1.1.0' as const,
    schema: 1 as const,
    revisionOffset: 0,
  };
  let pending = Promise.withResolvers<AccessProof>();
  const boundary = new OfflineAccess(scope, () => pending.promise);
  const network = new PreparedNetworkCondition(boundary);
  const events: boolean[] = [];
  let completed = false;
  network.online$.subscribe({
    next: (online) => events.push(online),
    complete: () => {
      completed = true;
    },
  });
  return {
    boundary,
    network,
    events,
    completed: () => completed,
    approve() {
      pending.resolve({ ...scope, restoring: false });
    },
    nextProof() {
      pending = Promise.withResolvers<AccessProof>();
    },
  };
}

test.each(['owner', 'viewer'] as const)(
  '%s SDK connectivity waits for both recovery and fresh access',
  async (role) => {
    const f = fixture(role);
    expect(f.network.online).toBe(false);
    const validating = f.boundary.validate();
    f.approve();
    await validating;
    expect(f.events).toEqual([false]);
    f.boundary.completeRecovery();
    expect(f.network.online).toBe(true);
    expect(f.events).toEqual([false, true]);
    if (role === 'viewer')
      expect(() => f.boundary.assertRemote(f.boundary.state.epoch, 'write')).toThrow();
    f.boundary.networkLost();
    expect(f.network.online).toBe(false);
    expect(f.events).toEqual([false, true, false]);
    f.nextProof();
    const checking = f.boundary.validate();
    expect(f.network.online).toBe(false);
    f.approve();
    await checking;
    expect(f.events).toEqual([false, true, false, true]);
    f.boundary.dispose();
    expect(f.network.online).toBe(false);
    expect(f.completed()).toBe(true);
  },
);
test('a late validation response after lock cannot advertise network approval', async () => {
  const f = fixture();
  f.boundary.completeRecovery();
  const checking = f.boundary.validate();
  f.boundary.lock('Signed out');
  f.approve();
  await checking;
  expect(f.network.online).toBe(false);
  expect(f.events).toEqual([false]);
});
test('a reentrant lock suppresses the superseded online value for later SDK subscribers', async () => {
  const f = fixture();
  f.boundary.completeRecovery();
  f.network.online$.subscribe((online) => {
    if (online) f.boundary.lock('Account changed');
  });
  const later: boolean[] = [];
  f.network.online$.subscribe((online) => later.push(online));
  const checking = f.boundary.validate();
  f.approve();
  await checking;
  expect(later).toEqual([false]);
  expect(f.network.online).toBe(false);
});
