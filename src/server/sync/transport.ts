import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import type { Express } from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { SyncError } from '@spinel/sync-server';
import type { SyncRevision } from '@spinel/sync-server';
import type { WorkspaceStore } from '../workspace/store.ts';
import type { CollaborationStore, SyncIdentity } from '../collaboration/service.ts';
import { documentIdentity, validateIdentity } from '../collaboration/identity.ts';
import { auditDeniedEdit } from '../collaboration/audit.ts';
import { safeGuestRoomPresence } from '../collaboration/guestPresence.ts';
import { Profiles } from '../auth/profile.ts';
import { profileAvatar } from '../../profile/profile.ts';

const TICKET_TTL = 30_000;
const MAX_TICKETS = 256;
const MAX_CONNECTIONS = 64;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
const MAX_PENDING = 8;
const MAX_CURSOR_BYTES = 512;
const CURSOR_BURST = 20;
const CURSORS_PER_SECOND = 10;
const HEARTBEAT_MS = 15_000;
interface Scope {
  itemId: string;
  spaceId?: string;
  guest: boolean;
  action: string;
}
interface Session {
  identity: SyncIdentity;
  unitId: string;
  itemId: string;
  rootId: string;
  access: string;
}
interface Ticket {
  session: Session;
  expires: number;
}
interface Connection {
  socket: WebSocket;
  session: Session;
  queue: Promise<void>;
  pending: number;
  revision: number;
  synchronized: boolean;
  memberId: string;
  selection?: string;
  cursorTokens: number;
  cursorAt: number;
  alive: boolean;
  heartbeatAt: number;
}

/** The route itself selects credentials and the exact document. Request bodies cannot broaden it. */
function scope(path: string): Scope | undefined {
  const match =
    /^\/sync-api\/(items|guest|spaces|guest-spaces)\/([a-f\d-]{36})(?:\/items\/([a-f\d-]{36}))?\/(ticket|snapshot|socket)$/.exec(
      path,
    );
  if (!match) return undefined;
  const space = match[1] === 'spaces' || match[1] === 'guest-spaces';
  if (space !== Boolean(match[3])) return undefined;
  return {
    itemId: match[3] ?? match[2],
    ...(space && { spaceId: match[2] }),
    guest: match[1].startsWith('guest'),
    action: match[4],
  };
}

/** Private durable fields (actor IDs, fingerprints, before-images) never enter the wire protocol. */
export function wireRevision(edit: SyncRevision) {
  return {
    revision: edit.revision,
    mutations: edit.mutations,
    touched: edit.touched,
    hash: edit.hash,
  };
}

/** Versioned edits and ephemeral authenticated presence, for every live document. */
export function attachSync(
  server: Server,
  app: Express,
  workspace: WorkspaceStore,
  collaboration: CollaborationStore,
  origin: string,
) {
  const sync = collaboration.sync;
  const tickets = new Map<string, Ticket>();
  const live = new Set<Connection>();
  const profiles = new Profiles(workspace.auth);
  const dirtyPresence = new Set<string>();
  let presenceScheduled = false;
  let closing = false;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  const pruneTickets = () => {
    for (const [key, ticket] of tickets) if (ticket.expires <= Date.now()) tickets.delete(key);
  };
  function current(session: Session, edit = false) {
    validateIdentity(workspace, session.identity.userID, session.identity.customData, edit);
    const item = collaboration.access(
      session.identity.userID,
      session.unitId,
      edit,
      session.identity.customData,
    );
    workspace.links.assertEpoch(session.rootId, session.identity.customData.privacyEpoch);
    if (
      item.id !== session.itemId ||
      item.access !== session.access ||
      collaboration.generations.restoring(item.id)
    )
      throw new SyncError('unavailable');
    return item;
  }
  function identify(
    headers: Parameters<typeof documentIdentity>[1],
    url: URL,
    target: Scope,
  ): Session {
    const identity = documentIdentity(
      workspace,
      headers,
      target.guest ? (target.spaceId ?? target.itemId) : undefined,
      target.spaceId ? { spaceId: target.spaceId, spaceItem: target.itemId } : undefined,
    );
    const unitId = url.searchParams.get('unitId');
    if (!unitId || collaboration.generations.active(target.itemId).unitId !== unitId)
      throw new SyncError('unavailable');
    const item = collaboration.access(identity.userId, unitId, false, identity.customData);
    const rootId = target.spaceId ?? target.itemId;
    const session: Session = {
      identity: {
        userID: identity.userId,
        customData: Object.freeze({
          ...identity.customData,
          unitID: unitId,
          privacyEpoch: workspace.links.epoch(rootId),
        }),
      },
      unitId,
      itemId: target.itemId,
      rootId,
      access: item.access,
    };
    current(session);
    return session;
  }
  function presenceChanged(unitId: string) {
    dirtyPresence.add(unitId);
    if (presenceScheduled || closing) return;
    presenceScheduled = true;
    queueMicrotask(() => {
      presenceScheduled = false;
      const units = [...dirtyPresence];
      dirtyPresence.clear();
      if (!closing) for (const unit of units) broadcastPresence(unit);
    });
  }
  function remove(entry: Connection, code?: number, reason?: string, terminate = false) {
    if (!live.delete(entry)) return;
    entry.selection = undefined;
    if (terminate) entry.socket.terminate();
    else if (code !== undefined) entry.socket.close(code, reason);
    presenceChanged(entry.session.unitId);
  }
  function send(entry: Connection, value: unknown): boolean {
    if (!live.has(entry) || entry.socket.readyState !== WebSocket.OPEN) return false;
    try {
      current(entry.session);
    } catch {
      remove(entry, 1008, 'Access changed. Reload to continue.');
      return false;
    }
    const data = JSON.stringify(value);
    if (entry.socket.bufferedAmount + Buffer.byteLength(data) > MAX_BUFFERED_BYTES) {
      remove(entry, 1009, 'Reload to continue.');
      return false;
    }
    entry.socket.send(data);
    return true;
  }
  function broadcastPresence(unitId: string) {
    for (const recipient of live) {
      if (recipient.session.unitId !== unitId) continue;
      try {
        current(recipient.session);
        const anonymous = workspace.links.state(recipient.session.rootId)?.state === 'active';
        const members = [];
        for (const member of live) {
          if (member.session.unitId !== unitId || member.socket.readyState !== WebSocket.OPEN)
            continue;
          try {
            // Every included member proves current access, not only the recipient.
            current(member.session);
            const guest = typeof member.session.identity.customData.guestHash === 'string';
            const profile =
              anonymous || guest ? undefined : profiles.get(member.session.identity.userID);
            members.push({
              id: member.memberId,
              name: guest ? 'Guest' : anonymous ? 'Collaborator' : profile!.name,
              avatar: profile ? profileAvatar(profile) : '',
              ...(member.selection && { selection: member.selection }),
            });
          } catch {
            remove(member, 1008, 'Access changed. Reload to continue.');
          }
        }
        send(recipient, { type: 'presence', selfId: recipient.memberId, members });
      } catch {
        remove(recipient, 1008, 'Access changed. Reload to continue.');
      }
    }
  }
  function revalidate() {
    pruneTickets();
    for (const entry of live) {
      try {
        current(entry.session);
      } catch {
        remove(entry, 1008, 'Access changed. Reload to continue.');
      }
    }
    return Promise.resolve();
  }
  // Registered after history's preparation hook. No await remains between this
  // scan and the engine's synchronous final guard + durable transaction.
  const submission = collaboration.onSubmitting(() => revalidate());
  const committed = collaboration.onCommitted((change) => {
    if (!change.syncRevision) return;
    for (const recipient of live) {
      if (recipient.session.unitId !== change.unitID || !recipient.synchronized) continue;
      try {
        current(recipient.session);
        if (change.revision <= recipient.revision) continue;
        if (change.revision !== recipient.revision + 1) {
          recipient.synchronized = false;
          send(recipient, { type: 'resync', reason: 'stale' });
          continue;
        }
        if (send(recipient, { type: 'edit', ...wireRevision(change.syncRevision) }))
          recipient.revision = change.revision;
      } catch {
        remove(recipient, 1008, 'Access changed. Reload to continue.');
      }
    }
  });
  app.use('/sync-api', (request, response) => {
    const url = new URL(request.originalUrl, origin);
    const target = scope(url.pathname);
    response.setHeader('Cache-Control', 'no-store');
    if (!target || target.action === 'socket') {
      response.status(404).end();
      return;
    }
    if (
      (request.headers.origin !== undefined && request.headers.origin !== origin) ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      (request.method !== 'GET' && request.headers.origin !== origin)
    ) {
      response.status(403).json({ error: 'Open Spinel at its configured address.' });
      return;
    }
    try {
      const session = identify(request.headers, url, target);
      if (target.action === 'ticket' && request.method === 'POST') {
        pruneTickets();
        if (tickets.size >= MAX_TICKETS) {
          response.status(429).end();
          return;
        }
        const ticket = randomBytes(32).toString('base64url');
        tickets.set(ticket, { session, expires: Date.now() + TICKET_TTL });
        response.json({ version: 1, ticket, expiresInMs: TICKET_TTL });
      } else if (target.action === 'snapshot' && request.method === 'GET') {
        const data = sync.load(session.unitId, session.identity);
        current(session);
        response.json({
          version: 1,
          unitId: data.unitId,
          revision: data.revision,
          snapshot: data.snapshot,
        });
      } else response.status(405).end();
    } catch {
      response.status(403).json({ error: 'This document is not available.' });
    }
  });
  // Use a named listener so close removes only this transport's handler.
  const onUpgrade: (
    request: import('node:http').IncomingMessage,
    socket: import('node:stream').Duplex,
    head: Buffer,
  ) => void = (request, socket, head) => {
    const reject = () => {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    };
    try {
      const url = new URL(request.url ?? '/', origin);
      const target = scope(url.pathname);
      if (
        !target ||
        target.action !== 'socket' ||
        request.headers.origin !== origin ||
        request.headers['sec-fetch-site'] === 'cross-site'
      ) {
        reject();
        return;
      }
      const after = url.searchParams.get('afterRevision');
      const afterRevision = after === null ? undefined : Number(after);
      if (
        url.searchParams.getAll('afterRevision').length > 1 ||
        (after !== null && (!/^[1-9]\d{0,15}$/.test(after) || !Number.isSafeInteger(afterRevision)))
      ) {
        reject();
        return;
      }
      const supplied = identify(request.headers, url, target);
      const key = url.searchParams.get('ticket') ?? '';
      const ticket = tickets.get(key);
      if (
        !ticket ||
        ticket.expires <= Date.now() ||
        wss.clients.size >= MAX_CONNECTIONS ||
        JSON.stringify(supplied) !== JSON.stringify(ticket.session)
      ) {
        reject();
        return;
      }
      tickets.delete(key);
      current(ticket.session);
      wss.handleUpgrade(request, socket, head, (ws) =>
        connected(ws, ticket.session, afterRevision),
      );
    } catch {
      reject();
    }
  };
  server.on('upgrade', onUpgrade);

  function connected(socket: WebSocket, session: Session, afterRevision?: number) {
    const entry: Connection = {
      socket,
      session,
      queue: Promise.resolve(),
      pending: 0,
      revision: 0,
      synchronized: false,
      memberId: randomBytes(18).toString('base64url'),
      cursorTokens: CURSOR_BURST,
      cursorAt: Date.now(),
      alive: true,
      heartbeatAt: Date.now() + HEARTBEAT_MS,
    };
    live.add(entry);
    socket.on('error', () => {
      remove(entry, undefined, undefined, true);
    });
    socket.on('close', () => remove(entry));
    socket.on('pong', () => {
      entry.alive = true;
    });
    try {
      // Subscribe before this synchronous read. No commit can land between the
      // returned head and activating subsequent broadcasts for this connection.
      if (afterRevision === undefined) {
        const data = sync.load(session.unitId, session.identity);
        current(session);
        entry.revision = data.revision;
        entry.synchronized = true;
        send(entry, {
          type: 'snapshot',
          version: 1,
          unitId: data.unitId,
          revision: data.revision,
          snapshot: data.snapshot,
        });
      } else {
        try {
          const data = sync.replay(session.unitId, afterRevision, session.identity);
          current(session);
          entry.revision = data.revision;
          entry.synchronized = true;
          send(entry, {
            type: 'resume',
            version: 1,
            unitId: session.unitId,
            fromRevision: afterRevision,
            revision: data.revision,
            edits: data.edits.map(wireRevision),
          });
        } catch (error) {
          if (!(error instanceof SyncError) || error.code !== 'stale') throw error;
          current(session);
          // Keep the receipt channel open: an accepted inflight edit may be
          // older than replay retention, and its immutable retry still succeeds.
          send(entry, { type: 'resync', reason: 'stale' });
        }
      }
    } catch {
      remove(entry, 1008, 'Reload to continue.');
      return;
    }
    presenceChanged(session.unitId);
    function failure(error: unknown, mutationId?: string) {
      try {
        current(session);
      } catch {
        remove(entry, 1008, 'Access changed. Reload to continue.');
        return;
      }
      send(entry, {
        type: 'resync',
        reason: error instanceof SyncError ? error.code : 'unavailable',
        ...(mutationId && { mutationId }),
      });
    }
    socket.on('message', (bytes, binary) => {
      if (!live.has(entry)) return;
      if (binary) {
        remove(entry, 1009, 'Use JSON messages.');
        return;
      }
      let message: Record<string, unknown>;
      let mutationId: string | undefined;
      try {
        try {
          message = JSON.parse(bytes.toString());
        } catch {
          throw new SyncError('malformed');
        }
        if (!message || typeof message !== 'object' || Array.isArray(message))
          throw new SyncError('malformed');
        if (
          message.type === 'submit' &&
          typeof message.mutationId === 'string' &&
          /^[A-Za-z0-9:_-]{1,128}$/.test(message.mutationId)
        )
          mutationId = message.mutationId;
        try {
          current(session);
        } catch (error) {
          if (message.type === 'submit')
            auditDeniedEdit(session.identity.userID, session.unitId, 'submitChangeset');
          throw error;
        }
        if (message.type === 'cursor') {
          const now = Date.now();
          entry.cursorTokens = Math.min(
            CURSOR_BURST,
            entry.cursorTokens + (Math.max(0, now - entry.cursorAt) * CURSORS_PER_SECOND) / 1000,
          );
          entry.cursorAt = now;
          if (
            Buffer.byteLength(bytes.toString()) > MAX_CURSOR_BYTES ||
            Object.keys(message).some((key) => !['type', 'selection'].includes(key)) ||
            !safeGuestRoomPresence(
              { unitID: session.unitId, memberID: entry.memberId, selection: message.selection },
              session.unitId,
              entry.memberId,
            ) ||
            entry.cursorTokens < 1
          ) {
            remove(entry, 1008, 'Invalid or excessive presence.');
            return;
          }
          entry.cursorTokens--;
          entry.selection = (message.selection as string) || undefined;
          presenceChanged(session.unitId);
          return;
        }
      } catch (error) {
        failure(error, mutationId);
        return;
      }
      if (++entry.pending > MAX_PENDING) {
        entry.pending--;
        remove(entry, 1009, 'Too many pending edits.');
        return;
      }
      entry.queue = entry.queue
        .then(async () => {
          if (!live.has(entry) || socket.readyState !== WebSocket.OPEN) return;
          try {
            current(session);
          } catch (error) {
            if (message.type === 'submit')
              auditDeniedEdit(session.identity.userID, session.unitId, 'submitChangeset');
            throw error;
          }
          if (message.type === 'verify') {
            if (Object.keys(message).some((key) => !['type', 'revision', 'hash'].includes(key)))
              throw new SyncError('malformed');
            const match = sync.verify(
              session.unitId,
              message.revision as number,
              message.hash as string,
              session.identity,
            );
            send(
              entry,
              match
                ? { type: 'verified', revision: message.revision }
                : { type: 'resync', reason: 'divergence' },
            );
            return;
          }
          if (
            message.type !== 'submit' ||
            Object.keys(message).some(
              (key) => !['type', 'mutationId', 'baseRevision', 'mutations'].includes(key),
            )
          )
            throw new SyncError('malformed');
          // The service owns edit authorization and its denied-edit audit.
          // Rejecting viewers here would bypass that single audited boundary.
          const result = await collaboration.submitSync(
            {
              unitId: session.unitId,
              mutationId: message.mutationId as string,
              baseRevision: message.baseRevision as number,
              mutations: message.mutations as SubmitParameters['mutations'],
            },
            session.identity,
          );
          // Authorization is checked independently for each recipient immediately before sending.
          for (const recipient of live) {
            if (recipient.session.unitId !== session.unitId || !recipient.synchronized) continue;
            try {
              current(recipient.session);
              const edits = result.missing.filter((edit) => edit.revision > recipient.revision);
              if (edits.length && edits[0].revision !== recipient.revision + 1) {
                recipient.synchronized = false;
                send(recipient, { type: 'resync', reason: 'stale' });
                continue;
              }
              for (const edit of edits) {
                if (send(recipient, { type: 'edit', ...wireRevision(edit) }))
                  recipient.revision = edit.revision;
              }
            } catch {
              remove(recipient, 1008, 'Access changed. Reload to continue.');
            }
          }
          current(session);
          send(entry, {
            type: 'ack',
            mutationId: message.mutationId,
            duplicate: result.duplicate,
            ...wireRevision(result.edit),
          });
        })
        .catch((error: unknown) => failure(error, mutationId))
        .finally(() => {
          entry.pending--;
        });
    });
  }
  type SubmitParameters = Parameters<CollaborationStore['submitSync']>[0];
  const timer = setInterval(() => {
    void revalidate();
    const now = Date.now();
    for (const entry of live) {
      if (entry.socket.readyState !== WebSocket.OPEN) {
        remove(entry);
      } else if (now >= entry.heartbeatAt) {
        if (!entry.alive) remove(entry, undefined, undefined, true);
        else {
          entry.alive = false;
          entry.heartbeatAt = now + HEARTBEAT_MS;
          entry.socket.ping();
        }
      }
    }
  }, 500);
  timer.unref();
  return {
    revalidate,
    connectionCount: () => live.size,
    async privacyChanged(itemId: string) {
      for (const [key, ticket] of tickets)
        if (ticket.session.rootId === itemId) tickets.delete(key);
      for (const entry of live)
        if (entry.session.rootId === itemId) {
          remove(entry, 1008, 'Sharing changed. Reload to continue.');
        }
      await revalidate();
    },
    async close() {
      closing = true;
      clearInterval(timer);
      submission.dispose();
      committed.dispose();
      server.off('upgrade', onUpgrade);
      const connections = [...live];
      for (const entry of connections) remove(entry, undefined, undefined, true);
      await Promise.allSettled(connections.map((entry) => entry.queue));
      live.clear();
      tickets.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
