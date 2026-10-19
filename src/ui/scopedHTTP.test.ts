import { expect, test } from 'vitest';
import { HTTPHeaders, HTTPRequest, HTTPResponse } from '@univerjs/network';
import { firstValueFrom, of } from 'rxjs';
import { OfflineAccess } from '../../web/offline/OfflineAccess.ts';
import type { OfflineScope } from '../../web/offline/OfflineAccess.ts';
import { ScopedHTTP, protocolRequestMode } from '../../web/offline/ScopedHTTP.ts';

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
test.each([
  '/universer-api/snapshot/2/unit/unit/rev/4',
  '/universer-api/snapshot/block/2/unit/unit/block/block-id',
  '/universer-api/user/session-ticket?unitID=unit',
])('allows a scoped protocol read: %s', (url) => {
  expect(protocolRequestMode(new HTTPRequest('GET', url), scope)).toBe('read');
});
test.each([
  'https://other.example/universer-api/snapshot/2/unit/unit/rev/4',
  '/universer-api/snapshot/2/unit/other/rev/4',
  '/universer-api/snapshot/1/unit/unit/rev/4',
  '/universer-api/user/session-ticket?unitID=other',
  '/universer-api/user/session-ticket?unitID=unit&unitID=other',
  '/api/items',
  '/universer-api/snapshot/2/unit/unit/unknown',
  '/universer-api/comb/2/unit/unit/new_changes',
  '/universer-api/snapshot/unknown/2/unit/unit/rev/4',
])('rejects foreign or unrecognized protocol reads: %s', (url) => {
  expect(() => protocolRequestMode(new HTTPRequest('GET', url), scope)).toThrow();
});
test('permission checks can read only the prepared unit, despite using POST', () => {
  const permission = (requests: unknown[]) =>
    new HTTPRequest('POST', '/universer-api/authz/-/object/-/batch_allowed', {
      headers: new HTTPHeaders(),
      body: { requests },
    });
  expect(protocolRequestMode(permission([{ unitID: 'unit' }]), scope)).toBe('read');
  expect(() =>
    protocolRequestMode(permission([{ unitID: 'unit' }, { unitID: 'other' }]), scope),
  ).toThrow();
  expect(() => protocolRequestMode(permission([]), scope)).toThrow();
});
test('final transport binds the captured account and leaves mutation payloads unchanged', async () => {
  const access = new OfflineAccess(scope, async () => ({ ...scope, restoring: false }));
  access.completeRecovery();
  await access.validate();
  const request = new HTTPRequest('POST', '/universer-api/comb/2/unit/unit/new_changes', {
    headers: new HTTPHeaders(),
    body: {
      unitID: 'unit',
      type: 2,
      changeset: {
        unitID: 'unit',
        type: 2,
        userID: 'owner',
        sid: 'original',
        reqId: 9,
        mutations: ['unchanged'],
      },
    },
  });
  const body = request.getBody();
  let sends = 0;
  const service = new ScopedHTTP(access, {
    send(received) {
      sends++;
      expect(received.headers.get('X-Spinel-Account')).toEqual(['owner']);
      expect(received.getBody()).toBe(body);
      return of(
        new HTTPResponse({ status: 200, body: {}, headers: new HTTPHeaders(), statusText: 'OK' }),
      );
    },
  });
  await firstValueFrom(service.send(request));
  await firstValueFrom(service.send(request));
  const retry = service.send(request);
  await firstValueFrom(retry);
  await firstValueFrom(retry);
  const queued = service.send(request);
  access.lock('Signed out.');
  await expect(firstValueFrom(queued)).rejects.toThrow();
  expect(sends).toBe(4);
  access.dispose();
});

test.each([
  'unit',
  'user',
  'payload',
  'header',
  'duplicate header',
  'viewer',
  'outer unit',
  'outer type',
  'inner type',
])('%s changes cannot reach the transport', async (change) => {
  const prepared = {
    ...scope,
    access: change === 'viewer' ? ('viewer' as const) : ('owner' as const),
  };
  const access = new OfflineAccess(prepared, async () => ({ ...prepared, restoring: false }));
  access.completeRecovery();
  await access.validate();
  const body = {
    unitID: 'unit',
    type: 2,
    changeset: { unitID: 'unit', type: 2, userID: 'owner', mutations: ['original'] },
  };
  const request = new HTTPRequest('POST', '/universer-api/comb/2/unit/unit/new_changes', {
    headers: new HTTPHeaders(),
    body,
  });
  let sends = 0;
  const service = new ScopedHTTP(access, {
    send() {
      sends++;
      return of(
        new HTTPResponse({ status: 200, body: {}, headers: new HTTPHeaders(), statusText: 'OK' }),
      );
    },
  });
  const queued = service.send(request);
  if (change === 'outer unit') body.unitID = 'other';
  if (change === 'outer type') body.type = 1;
  if (change === 'inner type') body.changeset.type = 1;
  if (change === 'duplicate header') {
    request.headers.set('X-Spinel-Account', 'owner');
    request.headers.set('X-Spinel-Account', 'owner');
  }
  if (change === 'unit') body.changeset.unitID = 'other';
  if (change === 'user') body.changeset.userID = 'other';
  if (change === 'payload') body.changeset.mutations.push('later');
  if (change === 'header') request.headers.set('X-Spinel-Account', 'other');
  await expect(firstValueFrom(queued)).rejects.toThrow();
  expect(sends).toBe(0);
  access.dispose();
});
