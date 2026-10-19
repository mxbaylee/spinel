import { expect, test } from 'vitest';
import { OfflineAccess } from '../../web/offline/OfflineAccess.ts';
import type { OfflineScope } from '../../web/offline/OfflineAccess.ts';
import { verifyOfflineAccess } from '../../web/offline/verifyOfflineAccess.ts';

const scope: OfflineScope = {
  origin: 'https://spinel.example',
  accountId: 'owner',
  itemId: 'item',
  unitId: 'unit',
  kind: 'sheet',
  access: 'owner',
  sdkVersion: '1.1.0',
  schema: 1,
  revisionOffset: 0,
};
const metadata = {
  accountId: 'owner',
  item: { id: 'item', kind: 'sheet', access: 'owner' },
  live: { unitId: 'unit', restoring: false, revisionOffset: 0, sdkVersion: '1.1.0' },
};
test('the control plane uses fresh same-instance metadata with account and generation in one response', async () => {
  const controller = new AbortController();
  let calls = 0;
  const request: typeof fetch = async (url, options) => {
    calls++;
    expect(url).toBe('https://spinel.example/api/items/item');
    expect(options).toMatchObject({
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'manual',
      signal: controller.signal,
    });
    return Response.json(metadata);
  };
  expect(await verifyOfflineAccess(scope, controller.signal, scope.origin, request)).toEqual({
    accountId: 'owner',
    itemId: 'item',
    unitId: 'unit',
    kind: 'sheet',
    access: 'owner',
    sdkVersion: '1.1.0',
    restoring: false,
    revisionOffset: 0,
  });
  await expect(
    verifyOfflineAccess(scope, controller.signal, 'https://other.example', request),
  ).rejects.toThrow(/another instance/);
  expect(calls).toBe(1);
});

test.each([302, 307, 401, 403, 404, 409, 500, 503])(
  'HTTP %i never reopens offline editing as a network outage',
  async (status) => {
    const access = new OfflineAccess(scope, (scope, signal) =>
      verifyOfflineAccess(
        scope,
        signal,
        scope.origin,
        async () => new Response('Unavailable', { status }),
      ),
    );
    access.completeRecovery();
    expect(await access.validate()).toBe(false);
    expect(access.state.phase).toBe('attention');
    expect(access.mayEditLocal).toBe(false);
    access.dispose();
  },
);

test('a transport failure permits prepared local work, but a malformed success does not', async () => {
  for (const [request, phase] of [
    [
      async () => {
        throw new TypeError('Network unavailable.');
      },
      'local',
    ],
    [async () => Response.json({ user: metadata.accountId }), 'attention'],
    [async () => Response.error(), 'attention'],
    [async () => new Response('<html>Sign in</html>'), 'attention'],
  ] as const) {
    const access = new OfflineAccess(scope, (scope, signal) =>
      verifyOfflineAccess(scope, signal, scope.origin, request),
    );
    access.completeRecovery();
    expect(await access.validate()).toBe(false);
    expect(access.state.phase).toBe(phase);
    access.dispose();
  }
});
