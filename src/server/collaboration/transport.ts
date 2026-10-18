import type { Server } from 'node:http';
import { CollabError } from '@univerjs-pro/collaboration-service';
import { UniverCollabEndpoint } from '@univerjs-pro/collaboration-endpoint';
import type { EndpointSession } from '@univerjs-pro/collaboration-endpoint';
import { createNodeTransport } from '@univerjs-pro/collaboration-transport-node';
import type { NodeTransportConnection } from '@univerjs-pro/collaboration-transport-node';
import { cookieToken } from '../auth/routes.ts';
import type { WorkspaceStore } from '../workspace/store.ts';
import type { ItemAccess } from '../../shared/workspace.ts';
import type { CollaborationStore } from './service.ts';

type LiveSession = {
  session: EndpointSession;
  connection: NodeTransportConnection;
  units: Map<string, ItemAccess>;
  joinDeadline: number;
};

/** All protocol requests bypass Express, so authentication belongs at this boundary too. */
export function attachCollaboration(
  server: Server,
  workspace: WorkspaceStore,
  collab: CollaborationStore,
  origin: string,
) {
  const auth = workspace.auth;
  const transport = createNodeTransport({
    maxRequestBodyBytes: 10 * 1024 * 1024,
    maxWebSocketMessageBytes: 64 * 1024,
  });
  const endpoint = new UniverCollabEndpoint(collab.service, { sessionTicketTtlMs: 30_000 });
  const live = new Map<string, LiveSession>();
  const denied = () => new CollabError('PERMISSION_DENIED', 'This document is not available.');
  function current(session: EndpointSession) {
    const hash = session.customData.sessionHash;
    if (typeof hash !== 'string' || auth.sessionByHash(hash)?.user_id !== session.userID)
      throw denied();
    workspace.owner(session.userID);
  }
  function documentScope(userID: string, url: string | undefined) {
    const unitID = new URL(url ?? '/', origin).searchParams.get('unitID');
    if (!unitID) throw denied();
    const item = collab.access(userID, unitID);
    if (item.kind !== 'sheet' && item.kind !== 'doc') throw denied();
    return unitID;
  }
  function scoped(session: EndpointSession, unitID: string) {
    current(session);
    if (session.customData.unitID !== unitID) throw denied();
    return collab.access(session.userID, unitID);
  }
  let validation = Promise.resolve();
  function revalidate() {
    validation = validation.then(scan, scan);
    return validation;
  }
  async function scan() {
    for (const [member, entry] of live) {
      try {
        current(entry.session);
        if (!entry.units.size && Date.now() > entry.joinDeadline) throw denied();
        for (const [id, access] of entry.units) {
          if (collab.access(entry.session.userID, id).access !== access) throw denied();
        }
      } catch {
        // SDK eviction is scoped by user, not auth session. Other tabs may reconnect;
        // this fail-closed tradeoff guarantees no later broadcast reaches a revoked socket.
        live.delete(member);
        entry.connection.close(1008, 'Access changed. Copy unsaved changes and reload.');
        for (const id of entry.units.keys())
          await endpoint.invalidateUnitSessions({ unitID: id, userID: entry.session.userID });
      }
    }
  }
  transport.use(async (context, next) => {
    const { incomingMessage: request, response } = context;
    response.setHeader('Cache-Control', 'no-store');
    const session = auth.session(cookieToken(request));
    const invalidOrigin = request.headers.origin !== undefined && request.headers.origin !== origin;
    if (
      invalidOrigin ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      (request.method !== 'GET' && request.headers.origin !== origin)
    ) {
      response.writeHead(403).end('Open Spinel at its configured address.');
      return;
    }
    if (!session?.user_id || auth.user(session.user_id)?.is_admin) {
      response.writeHead(401).end('Sign in with your everyday account.');
      return;
    }
    context.userID = session.user_id;
    context.customData.sessionHash = session.token_hash;
    if (new URL(request.url ?? '/', origin).pathname === '/universer-api/user/session-ticket') {
      try {
        context.customData.unitID = documentScope(session.user_id, request.url);
      } catch {
        response.writeHead(403).end('This document is not available.');
        return;
      }
    }
    await revalidate();
    await next();
  });
  transport.useUpgrade(async (context, next) => {
    const session = auth.session(cookieToken(context.incomingMessage));
    if (
      context.incomingMessage.headers.origin !== origin ||
      !session?.user_id ||
      auth.user(session.user_id)?.is_admin
    ) {
      context.reject(403, 'Sign in at the configured Spinel address.');
      return;
    }
    try {
      context.customData.unitID = documentScope(session.user_id, context.incomingMessage.url);
    } catch {
      context.reject(403, 'This document is not available.');
      return;
    }
    context.customData.sessionHash = session.token_hash;
    await next();
  });
  endpoint.use('connect', async (context, next) => {
    current(context.session);
    if (
      context.connection.customData.sessionHash !== context.session.customData.sessionHash ||
      context.connection.customData.unitID !== context.session.customData.unitID
    )
      throw denied();
    if (live.size >= 64) throw new CollabError('PERMISSION_DENIED', 'Too many open editors.');
    context.member.name = auth.user(context.session.userID)!.name;
    context.member.avatar = '';
    live.set(context.session.memberID, {
      session: context.session,
      connection: context.connection,
      units: new Map(),
      joinDeadline: Date.now() + 30_000,
    });
    await next();
  });
  endpoint.use('joinUnit', async (context, next) => {
    const access = scoped(context.session, context.unitID).access;
    await collab.prepare(context.session.userID, collab.itemForUnit(context.unitID));
    scoped(context.session, context.unitID);
    live.get(context.session.memberID)?.units.set(context.unitID, access);
    await next();
  });
  endpoint.on('memberLeftUnit', ({ session, unitID, reason }) => {
    const entry = live.get(session.memberID);
    entry?.units.delete(unitID);
    if (reason === 'connection-closed' || reason === 'endpoint-disposed' || !entry?.units.size) {
      live.delete(session.memberID);
      entry?.connection.close(1000, 'Editor closed.');
    }
  });
  endpoint.use('receivePresence', async (context, next) => {
    await revalidate();
    scoped(context.session, context.unitID);
    await next();
  });
  endpoint.use('sendPresence', async (context, next) => {
    const target = live.get(context.targetMemberID);
    if (!target) throw denied();
    scoped(target.session, context.unitID);
    await next();
  });
  // Evict revoked recipients before SDK commit events can broadcast document changes.
  collab.service.use('commitChangeset', async (context, next) => {
    await revalidate();
    if (auth.sessionByHash(String(context.customData.sessionHash))?.user_id !== context.userID)
      throw denied();
    collab.access(context.userID, context.changeset.unitID, true);
    await next();
  });
  transport.register(endpoint);
  transport.attach(server);
  const timer = setInterval(() => {
    void revalidate().catch(() => {});
  }, 500);
  timer.unref();
  return {
    revalidate,
    async close() {
      clearInterval(timer);
      await transport.dispose();
      live.clear();
    },
  };
}
