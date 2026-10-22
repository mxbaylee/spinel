import { Profiles } from '../auth/profile.ts';
import { profileAvatar } from '../../profile/profile.ts';
import { safeGuestRoomPresence } from './guestPresence.ts';
import type { Server } from 'node:http';
import { CollabError } from '@univerjs-pro/collaboration-service';
import { UniverCollabEndpoint } from '@univerjs-pro/collaboration-endpoint';
import type { EndpointSession } from '@univerjs-pro/collaboration-endpoint';
import { createNodeTransport } from '@univerjs-pro/collaboration-transport-node';
import type { NodeTransportConnection } from '@univerjs-pro/collaboration-transport-node';
import {
  documentIdentity,
  protocolGuestItem,
  protocolSpaceScope,
  validateIdentity,
} from './identity.ts';
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
  options: { spaceReview?: boolean } = {},
) {
  const auth = workspace.auth;
  const transport = createNodeTransport({
    maxRequestBodyBytes: 10 * 1024 * 1024,
    maxWebSocketMessageBytes: 64 * 1024,
  });
  const endpoint = new UniverCollabEndpoint(collab.service, { sessionTicketTtlMs: 30_000 });
  const live = new Map<string, LiveSession>();
  const denied = () => new CollabError('PERMISSION_DENIED', 'This document is not available.');
  function authorizedScope(userID: string, unitID: string, custom: Record<string, unknown>) {
    const item = collab.access(userID, unitID, false, custom);
    // access() has already checked the current account session, exact Space +
    // stable child, live generation, grant and enabled owner. Space review has
    // no guest-link lifecycle; the ordinary-only epoch guard must remain closed
    // to it. No caller gets this branch merely from a Space-looking item ID.
    if (Object.hasOwn(custom, 'spaceId')) return { item, privacyEpoch: undefined };
    const privacyEpoch = workspace.links.epoch(item.id);
    workspace.links.assertEpoch(item.id, privacyEpoch);
    return { item, privacyEpoch };
  }
  function current(session: EndpointSession) {
    try {
      validateIdentity(workspace, session.userID, session.customData);
      const { item, privacyEpoch } = authorizedScope(
        session.userID,
        String(session.customData.unitID),
        session.customData,
      );
      if (privacyEpoch !== session.customData.privacyEpoch) throw denied();
      return item;
    } catch {
      throw denied();
    }
  }
  function documentScope(userID: string, url: string | undefined, custom: Record<string, unknown>) {
    const unitID = new URL(url ?? '/', origin).searchParams.get('unitID');
    if (!unitID) throw denied();
    const scope = authorizedScope(userID, unitID, custom);
    if (scope.item.kind !== 'sheet' && scope.item.kind !== 'doc') throw denied();
    return { unitID, privacyEpoch: scope.privacyEpoch };
  }
  function scoped(session: EndpointSession, unitID: string) {
    const item = current(session);
    if (session.customData.unitID !== unitID) throw denied();
    return item;
  }
  let validation = Promise.resolve();
  function revalidate() {
    validation = validation.then(scan, scan);
    return validation;
  }
  async function scan() {
    for (const [member, entry] of live) {
      try {
        const item = current(entry.session);
        if (!entry.units.size && Date.now() > entry.joinDeadline) throw denied();
        for (const [id, access] of entry.units) {
          if (id !== entry.session.customData.unitID || item.access !== access) throw denied();
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
    let identity: ReturnType<typeof documentIdentity>;
    try {
      identity = documentIdentity(
        workspace,
        request.headers,
        protocolGuestItem(request.url, origin),
        protocolSpaceScope(request.url, origin, options.spaceReview),
      );
    } catch {
      response.writeHead(401).end('This document is not available.');
      return;
    }
    const invalidOrigin = request.headers.origin !== undefined && request.headers.origin !== origin;
    if (
      invalidOrigin ||
      request.headers['sec-fetch-site'] === 'cross-site' ||
      (request.method !== 'GET' && request.headers.origin !== origin)
    ) {
      response.writeHead(403).end('Open Spinel at its configured address.');
      return;
    }
    context.userID = identity.userId;
    Object.assign(context.customData, identity.customData);
    if (
      new URL(request.url ?? '/', origin).pathname.endsWith('/universer-api/user/session-ticket')
    ) {
      try {
        Object.assign(
          context.customData,
          documentScope(identity.userId, request.url, identity.customData),
        );
      } catch {
        response.writeHead(403).end('This document is not available.');
        return;
      }
    }
    await revalidate();
    await next();
  });
  transport.useUpgrade(async (context, next) => {
    if (context.incomingMessage.headers.origin !== origin) {
      context.reject(403, 'Open Spinel at its configured address.');
      return;
    }
    try {
      const identity = documentIdentity(
        workspace,
        context.incomingMessage.headers,
        protocolGuestItem(context.incomingMessage.url, origin),
        protocolSpaceScope(context.incomingMessage.url, origin, options.spaceReview),
      );
      const scope = documentScope(
        identity.userId,
        context.incomingMessage.url,
        identity.customData,
      );
      Object.assign(context.customData, identity.customData, scope);
    } catch {
      context.reject(403, 'This document is not available.');
      return;
    }
    await next();
  });
  const admissions = new Map<string, Set<Promise<void>>>();
  async function admission(session: EndpointSession, next: () => Promise<void>) {
    current(session);
    const id = collab.itemForUnit(String(session.customData.unitID));
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = admissions.get(id) ?? new Set<Promise<void>>();
    active.add(pending);
    admissions.set(id, active);
    try {
      await next();
      current(session);
    } finally {
      active.delete(pending);
      if (!active.size) admissions.delete(id);
      release();
    }
  }
  endpoint.use('connect', async (context, next) => {
    current(context.session);
    if (
      context.connection.customData.sessionHash !== context.session.customData.sessionHash ||
      context.connection.customData.guestHash !== context.session.customData.guestHash ||
      context.connection.customData.guestItem !== context.session.customData.guestItem ||
      context.connection.customData.spaceId !== context.session.customData.spaceId ||
      context.connection.customData.spaceItem !== context.session.customData.spaceItem ||
      context.connection.customData.privacyEpoch !== context.session.customData.privacyEpoch ||
      context.connection.customData.unitID !== context.session.customData.unitID
    )
      throw denied();
    if (live.size >= 64) throw new CollabError('PERMISSION_DENIED', 'Too many open editors.');
    const linked =
      workspace.links.state(collab.itemForUnit(String(context.session.customData.unitID)))
        ?.state === 'active';
    context.member.name = context.session.userID.startsWith('guest:')
      ? 'Guest'
      : linked
        ? 'Collaborator'
        : auth.user(context.session.userID)!.name;
    context.member.avatar =
      linked || context.session.userID.startsWith('guest:')
        ? ''
        : profileAvatar(new Profiles(auth).get(context.session.userID));
    live.set(context.session.memberID, {
      session: context.session,
      connection: context.connection,
      units: new Map(),
      joinDeadline: Date.now() + 30_000,
    });
    await admission(context.session, next);
  });
  endpoint.use('joinUnit', async (context, next) => {
    await admission(context.session, async () => {
      const access = scoped(context.session, context.unitID).access;
      await collab.prepare(
        context.session.userID,
        collab.itemForUnit(context.unitID),
        context.session.customData,
      );
      scoped(context.session, context.unitID);
      live.get(context.session.memberID)?.units.set(context.unitID, access);
      await next();
    });
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
    if (
      workspace.links.state(collab.itemForUnit(context.unitID))?.state === 'active' &&
      !safeGuestRoomPresence(context.payload, context.unitID, context.session.memberID)
    )
      throw denied();
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
    try {
      validateIdentity(workspace, context.userID, context.customData, true);
    } catch {
      throw denied();
    }
    collab.access(context.userID, context.changeset.unitID, true, context.customData);
    await next();
  });
  // All namespaces share one room host. The review namespace is absent by default.
  const spacePrefix = '/space-api/:spaceId/items/:spaceItem';
  transport.register({
    register(router) {
      endpoint.register({
        get(path, handler) {
          router.get(path, handler);
          router.get('/guest-api/:guestItem' + path, handler);
          if (options.spaceReview) router.get(spacePrefix + path, handler);
        },
        post(path, handler) {
          router.post(path, handler);
          router.post('/guest-api/:guestItem' + path, handler);
          if (options.spaceReview) router.post(spacePrefix + path, handler);
        },
        delete(path, handler) {
          router.delete(path, handler);
          router.delete('/guest-api/:guestItem' + path, handler);
          if (options.spaceReview) router.delete(spacePrefix + path, handler);
        },
        upgrade(path, handler) {
          router.upgrade(path, handler);
          router.upgrade('/guest-api/:guestItem' + path, handler);
          if (options.spaceReview) router.upgrade(spacePrefix + path, handler);
        },
      });
    },
    dispose() {
      return endpoint.dispose();
    },
  });
  transport.attach(server);
  const timer = setInterval(() => {
    void revalidate().catch(() => {});
  }, 500);
  timer.unref();
  return {
    revalidate,
    async privacyChanged(itemId: string) {
      // begin() has already fenced admission and revoked all prior guest credentials.
      await Promise.all(admissions.get(itemId) ?? []);
      const unitID = collab.generations.active(itemId).unitId;
      for (const [member, entry] of live) {
        if (entry.session.customData.unitID !== unitID) continue;
        live.delete(member);
        entry.connection.close(1008, 'Sharing changed. Reload to continue.');
      }
      await endpoint.invalidateUnitSessions({ unitID });
    },
    async close() {
      clearInterval(timer);
      await transport.dispose();
      live.clear();
    },
  };
}
