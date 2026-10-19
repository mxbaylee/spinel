import type { ICombRequestEvent } from '@univerjs-pro/collaboration';
import type { ICollaborationSocket } from '@univerjs-pro/collaboration-client';
import { CombCmd } from '@univerjs/protocol';
import { filter, Subscription } from 'rxjs';
import type { OfflineAccess, OfflineScope } from './OfflineAccess.ts';

export function socketRequestMode(event: ICombRequestEvent, scope: OfflineScope): 'read' | 'write' {
  const unit = scope.unitId;
  const type = scope.kind === 'doc' ? 1 : 2;
  const deny = () => {
    throw new Error('Socket operation left its prepared scope.');
  };
  if (event.cmd === CombCmd.HELLO || event.cmd === CombCmd.HEARTBEAT) {
    if (event.routeKey && event.routeKey !== unit) return deny();
    return 'read';
  }
  if (event.routeKey !== unit) return deny();
  if (event.cmd === CombCmd.JOIN) {
    if (!event.data.rooms.length || event.data.rooms.some((room) => room.roomID !== unit))
      return deny();
    return 'read';
  }
  if (event.cmd === CombCmd.LEAVE) {
    if (event.data.roomID !== unit) return deny();
    return 'read';
  }
  if (event.cmd !== CombCmd.INGEST) return deny();
  if (!('data' in event.data)) return deny();
  const payload = event.data.data;
  if (!payload || payload.unitID !== unit) return deny();
  switch (event.data.eventID) {
    case 'fetch_missing':
      if (payload.unitType !== type) return deny();
      return 'read';
    case 'update_cursor':
      if (payload.userID !== scope.accountId) return deny();
      return 'read';
    case 'submit_changeset':
      if (
        payload.unitType !== type ||
        payload.changeset?.unitID !== unit ||
        payload.changeset.type !== type ||
        payload.changeset.userID !== scope.accountId
      )
        return deny();
      return 'write';
    default:
      return deny();
  }
}

/** Wrap the public collaboration socket without changing operation identities. */
export function scopedSocket(
  access: OfflineAccess,
  epoch: number,
  socket: ICollaborationSocket,
): ICollaborationSocket {
  let closed = false;
  const lifetime = new Subscription();
  const close = () => {
    if (closed) return;
    closed = true;
    lifetime.unsubscribe();
    socket.close();
  };
  const current = () => {
    try {
      access.assertRemote(epoch, 'read');
      return !closed;
    } catch {
      return false;
    }
  };
  // Check per subscriber delivery: an earlier listener can synchronously lock.
  const wrapped: ICollaborationSocket = {
    get memberID() {
      return socket.memberID;
    },
    set memberID(value) {
      socket.memberID = value;
    },
    open$: socket.open$.pipe(filter(current)),
    message$: socket.message$.pipe(filter(current)),
    error$: socket.error$,
    close$: socket.close$,
    send(event) {
      if (closed) throw new Error('Prepared socket is closed.');
      access.assertRemote(epoch, socketRequestMode(event, access.scope));
      socket.send(event);
    },
    close,
  };
  lifetime.add(
    socket.close$.subscribe(() => {
      closed = true;
      lifetime.unsubscribe();
    }),
  );
  lifetime.add(
    access.state$.subscribe(() => {
      if (!current()) close();
    }),
  );
  return wrapped;
}
