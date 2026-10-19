import { expect, test } from 'vitest';
import { Observable, of } from 'rxjs';
import type { Subscriber } from 'rxjs';
import { OfflineAccess } from '../../web/offline/OfflineAccess.ts';
import type { OfflineScope } from '../../web/offline/OfflineAccess.ts';
import { remoteRequest } from '../../web/offline/remoteRequest.ts';

const scope: OfflineScope = {
  origin: 'https://spinel.example',
  accountId: 'owner',
  itemId: 'item',
  unitId: 'unit',
  kind: 'doc',
  access: 'owner',
  sdkVersion: '1.1.0',
  schema: 1,
  revisionOffset: 0,
};
async function ready(role: OfflineScope['access'] = 'owner') {
  const prepared = { ...scope, access: role };
  const access = new OfflineAccess(prepared, async () => ({ ...prepared, restoring: false }));
  access.completeRecovery();
  await access.validate();
  return access;
}

test('delayed subscriptions and retries cannot send an old request under new access', async () => {
  const access = await ready();
  let sends = 0;
  const queued = remoteRequest(access, 'write', () => {
    sends++;
    return of('sent');
  });
  access.networkLost();
  await access.validate();
  const errors: unknown[] = [];
  queued.subscribe({ error: (error) => errors.push(error) });
  queued.subscribe({ error: (error) => errors.push(error) });
  expect(sends).toBe(0);
  expect(errors).toHaveLength(2);
  const received: string[] = [];
  remoteRequest(access, 'write', () => {
    sends++;
    return of('new epoch');
  }).subscribe((value) => received.push(value));
  expect(received).toEqual(['new epoch']);
  expect(sends).toBe(1);
  access.dispose();
});

test.each(['network', 'sign-out', 'recovery failure', 'dispose'])(
  '%s cancels active transport and rejects late content',
  async (reason) => {
    const access = await ready();
    let source!: Subscriber<string>;
    let cancelled = 0;
    const received: string[] = [];
    const errors: unknown[] = [];
    remoteRequest(
      access,
      'read',
      () =>
        new Observable<string>((observer) => {
          source = observer;
          return () => {
            cancelled++;
          };
        }),
    ).subscribe({ next: (value) => received.push(value), error: (error) => errors.push(error) });
    source.next('permitted');
    if (reason === 'network') access.networkLost();
    else if (reason === 'sign-out') access.lock('Signed out.');
    else if (reason === 'recovery failure') access.failRecovery('Recovery failed.');
    else access.dispose();
    expect(cancelled).toBe(1);
    expect(errors).toHaveLength(1);
    source.next('late private content');
    expect(received).toEqual(['permitted']);
    access.dispose();
  },
);

test('a factory that locks access cannot start its returned transport', async () => {
  const access = await ready();
  let sends = 0;
  const errors: unknown[] = [];
  remoteRequest(access, 'read', () => {
    access.lock('Account changed.');
    return new Observable(() => {
      sends++;
    });
  }).subscribe({ error: (error) => errors.push(error) });
  expect(sends).toBe(0);
  expect(errors).toHaveLength(1);
  access.dispose();
});

test('synchronous delivery can lock and close the source before setup continues', async () => {
  const access = await ready();
  let afterLock = 0;
  let closedDuringSetup = false;
  let cancelled = 0;
  remoteRequest(
    access,
    'read',
    () =>
      new Observable<string>((source) => {
        source.next('first event');
        closedDuringSetup = source.closed;
        if (!source.closed) afterLock++;
        return () => {
          cancelled++;
        };
      }),
  ).subscribe({
    next() {
      access.lock('Signed out in response handler.');
    },
    error() {},
  });
  expect(closedDuringSetup).toBe(true);
  expect(afterLock).toBe(0);
  expect(cancelled).toBe(1);
  access.dispose();
});

test('viewer writes fail before invoking the transport while authorized reads work', async () => {
  const access = await ready('viewer');
  let writes = 0;
  const errors: unknown[] = [];
  const received: string[] = [];
  remoteRequest(access, 'write', () => {
    writes++;
    return of('bad');
  }).subscribe({ error: (error) => errors.push(error) });
  remoteRequest(access, 'read', () => of('view')).subscribe((value) => received.push(value));
  expect(writes).toBe(0);
  expect(errors).toHaveLength(1);
  expect(received).toEqual(['view']);
  access.dispose();
});
