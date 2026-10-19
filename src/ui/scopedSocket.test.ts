import { expect, test } from 'vitest';
import { CombCmd } from '@univerjs/protocol';
import type { ICombRequestEvent, ICombResponseEvent } from '@univerjs-pro/collaboration';
import { Subject } from 'rxjs';
import { OfflineAccess } from '../../web/offline/OfflineAccess.ts';
import type { OfflineScope } from '../../web/offline/OfflineAccess.ts';
import { scopedSocket, socketRequestMode } from '../../web/offline/scopedSocket.ts';

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
const hello: ICombRequestEvent = { cmd: CombCmd.HELLO, routeKey: '', routeType: '' };
function submit(): ICombRequestEvent {
  return {
    cmd: CombCmd.INGEST,
    routeKey: 'unit',
    routeType: '',
    data: {
      eventID: 'submit_changeset',
      data: {
        unitID: 'unit',
        unitType: 1,
        memberID: 'member',
        changeset: {
          unitID: 'unit',
          type: 1,
          userID: 'owner',
          sid: 'original',
          reqId: 7,
          baseRev: 1,
          revision: 0,
          memberID: 'member',
          mutations: [],
        },
      },
    },
  };
}
async function fixture(role: OfflineScope['access'] = 'owner') {
  const prepared = { ...scope, access: role };
  const access = new OfflineAccess(prepared, async () => ({ ...prepared, restoring: false }));
  access.completeRecovery();
  await access.validate();
  const open$ = new Subject<Event>(),
    close$ = new Subject<Event>(),
    error$ = new Subject<Event>(),
    message$ = new Subject<ICombResponseEvent>();
  const sent: ICombRequestEvent[] = [];
  let closes = 0;
  const original = {
    memberID: 'first',
    open$,
    close$,
    error$,
    message$,
    send(event: ICombRequestEvent) {
      expect(this).toBe(original);
      sent.push(event);
    },
    close() {
      expect(this).toBe(original);
      closes++;
      close$.next(new Event('close'));
    },
  };
  const socket = scopedSocket(access, access.state.epoch, original);
  return { access, original, socket, sent, closes: () => closes };
}
test('socket keeps live member identity and passes original operation identities unchanged', async () => {
  const f = await fixture();
  f.original.memberID = 'server-member';
  expect(f.socket.memberID).toBe('server-member');
  f.socket.memberID = 'updated';
  expect(f.original.memberID).toBe('updated');
  const event = submit();
  f.socket.send(event);
  expect(f.sent[0]).toBe(event);
  f.access.dispose();
  expect(f.closes()).toBe(1);
});
test.each(['lock', 'outage', 'revalidate', 'dispose'])(
  '%s closes once and cannot resurrect the old socket',
  async (action) => {
    const f = await fixture();
    const messages: unknown[] = [],
      closed: unknown[] = [];
    f.socket.message$.subscribe((value) => messages.push(value));
    f.socket.close$.subscribe((value) => closed.push(value));
    if (action === 'lock') f.access.lock('Signed out.');
    if (action === 'outage') f.access.networkLost();
    if (action === 'revalidate') await f.access.validate();
    if (action === 'dispose') f.access.dispose();
    await f.access.validate();
    expect(() => f.socket.send(hello)).toThrow();
    f.original.message$.next({} as ICombResponseEvent);
    expect(messages).toEqual([]);
    expect(closed).toHaveLength(1);
    f.socket.close();
    f.access.dispose();
    expect(f.closes()).toBe(1);
  },
);
test('a first listener locking access hides the same event from later listeners', async () => {
  const f = await fixture();
  let deliveries = 0;
  f.socket.message$.subscribe(() => {
    deliveries++;
    f.access.lock('Changed account.');
  });
  f.socket.message$.subscribe(() => deliveries++);
  f.original.message$.next({} as ICombResponseEvent);
  expect(deliveries).toBe(1);
  expect(f.closes()).toBe(1);
  f.access.dispose();
});
test('viewer can handshake but never submit mutations', async () => {
  const f = await fixture('viewer');
  f.socket.send(hello);
  expect(() => f.socket.send(submit())).toThrow();
  expect(f.sent).toEqual([hello]);
  f.access.dispose();
});
test.each(['outer unit', 'outer type', 'inner unit', 'inner type', 'account', 'route', 'unknown'])(
  'rejects %s mismatch',
  (change) => {
    const event = submit();
    if (event.cmd !== CombCmd.INGEST || !('data' in event.data)) throw new Error('fixture');
    const payload = event.data.data;
    if (change === 'outer unit') payload.unitID = 'other';
    if (change === 'outer type') payload.unitType = 2;
    if (change === 'inner unit') payload.changeset.unitID = 'other';
    if (change === 'inner type') payload.changeset.type = 2;
    if (change === 'account') payload.changeset.userID = 'other';
    if (change === 'route') event.routeKey = 'other';
    if (change === 'unknown') event.data.eventID = 'custom';
    expect(() => socketRequestMode(event, scope)).toThrow();
  },
);
test('join/leave cannot reach another room', () => {
  const join: ICombRequestEvent = {
    cmd: CombCmd.JOIN,
    routeKey: 'unit',
    routeType: '',
    data: { rooms: [{ roomID: 'unit', args: '' }] },
  };
  expect(socketRequestMode(join, scope)).toBe('read');
  join.data.rooms.push({ roomID: 'other', args: '' });
  expect(() => socketRequestMode(join, scope)).toThrow();
  expect(() =>
    socketRequestMode(
      { cmd: CombCmd.LEAVE, routeKey: 'unit', routeType: '', data: { roomID: 'other', args: '' } },
      scope,
    ),
  ).toThrow();
});
