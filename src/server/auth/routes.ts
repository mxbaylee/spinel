import express from 'express';
import { Profiles } from './profile.ts';
import type { Request, Response, NextFunction } from 'express';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { AuthError, AuthStore, COOKIE_NAME } from './store.ts';
import { AuthService } from './service.ts';
import { SetupService } from './setup.ts';
import { ConsoleRecovery } from './console-recovery.ts';
import { InvitationService } from './invitations.ts';
import type { Session } from './store.ts';
import { AdminStore } from './admin.ts';
import { OwnershipTransfer } from './ownership.ts';
import { AccessTokens } from './tokens.ts';
import { AssistantOAuth } from './oauth.ts';

export function cookieToken(request: Pick<Request, 'headers'>) {
  const tokens = (request.headers.cookie ?? '')
    .split(';')
    .map((value) => value.trim())
    .filter((value) => value.startsWith(`${COOKIE_NAME}=`));
  return tokens.length === 1 ? tokens[0].slice(COOKIE_NAME.length + 1) : undefined;
}
export function setSessionCookie(response: Response, token: string, expires: number) {
  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    expires: new Date(expires),
  });
}
export function authRoutes(
  store: AuthStore,
  origin: string,
  accessChanged: () => Promise<void> = async () => {},
) {
  const router = express.Router();
  const service = new AuthService(store, origin);
  const profiles = new Profiles(store);
  const setup = new SetupService(store, origin);
  const recovery = new ConsoleRecovery(store, origin);
  const invites = new InvitationService(store, origin);
  const admin = new AdminStore(store, invites);
  const ownership = new OwnershipTransfer(store);
  const tokens = new AccessTokens(store);
  const oauth = new AssistantOAuth(store, origin);
  const requireSession = (request: Request, authenticated = false): Session => {
    const session = store.session(cookieToken(request));
    if (!session || (authenticated && !session.user_id))
      throw new AuthError(401, 'Your session expired. Sign in again.');
    return session;
  };
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.use((request, _response, next) => {
    if (
      request.method !== 'GET' &&
      (request.headers.origin !== service.origin || !request.is('application/json'))
    ) {
      throw new AuthError(403, 'Open Spinel at its configured address and try again.');
    }
    next();
  });
  router.use(express.json({ limit: '64kb', strict: true }));
  router.get('/profile', (request, response) =>
    response.json(profiles.get(requireSession(request, true).user_id!)),
  );
  router.post('/profile', (request, response) =>
    response.json(profiles.save(requireSession(request, true).user_id!, request.body)),
  );
  router.get('/session', (request, response) => {
    const session = requireSession(request, true);
    const user = store.user(session.user_id!)!;
    response.json({
      user: { id: user.id, ...profiles.get(user.id), isAdmin: Boolean(user.is_admin) },
    });
  });
  const requireAdmin = (request: Request) => {
    const session = store.session(cookieToken(request));
    if (!session?.user_id || !store.user(session.user_id)?.is_admin)
      throw new AuthError(404, 'Not found.');
    return session;
  };
  router.get('/tokens', (request, response) => {
    response.json({ tokens: tokens.list(requireSession(request, true).user_id!) });
  });
  router.get('/connections', (request, response) => {
    response.json({ connections: oauth.list(requireSession(request, true).user_id!) });
  });
  router.post('/connections/:id/revoke', (request, response) => {
    oauth.disconnect(requireSession(request, true).user_id!, String(request.params.id));
    response.sendStatus(204);
  });
  router.get('/admin/connections', (request, response) => {
    response.json({ connections: oauth.list(requireAdmin(request).user_id!, true) });
  });
  router.get('/oauth/pending/:id', (request, response) => {
    response.json(oauth.details(String(request.params.id), requireSession(request, true)));
  });
  router.post('/oauth/pending/:id', (request, response) => {
    response.json(
      oauth.consent(String(request.params.id), requireSession(request, true), request.body?.allow),
    );
  });
  router.post('/tokens', (request, response) => {
    response
      .status(201)
      .json(tokens.create(requireSession(request, true).user_id!, request.body?.name));
  });
  router.post('/tokens/:id/revoke', (request, response) => {
    tokens.revoke(requireSession(request, true).user_id!, String(request.params.id));
    response.sendStatus(204);
  });
  router.get('/admin/tokens', (request, response) => {
    response.json({ tokens: tokens.adminList(requireAdmin(request).user_id!) });
  });
  router.get('/admin/users', (request, response) => {
    response.json({ users: admin.list(requireAdmin(request).user_id!) });
  });
  router.post('/admin/users/:id/disable', async (request, response) => {
    admin.disable(requireAdmin(request).user_id!, String(request.params.id));
    await accessChanged();
    response.sendStatus(204);
  });
  router.post('/admin/users/:id/reactivate', async (request, response) => {
    const actor = requireAdmin(request).user_id!;
    if (!request.body || Array.isArray(request.body) || Object.keys(request.body).length)
      throw new AuthError(400, 'Confirm reactivation without additional account changes.');
    admin.reactivate(actor, String(request.params.id));
    try {
      await accessChanged();
    } catch {
      throw new AuthError(
        503,
        'Account reactivated, but open connections could not refresh. Refresh accounts to see the result.',
      );
    }
    response.sendStatus(204);
  });
  router.get('/admin/users/:id/transfer-preview', (request, response) => {
    response.json(ownership.preview(requireAdmin(request).user_id!, String(request.params.id)));
  });
  router.post('/admin/users/:id/transfer', async (request, response) => {
    const actor = requireAdmin(request).user_id!;
    const body = request.body;
    if (
      !body ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !['targetId', 'confirmation'].includes(key)) ||
      typeof body.targetId !== 'string' ||
      typeof body.confirmation !== 'string'
    )
      throw new AuthError(400, 'Choose an account and confirm the current transfer details.');
    ownership.transfer(actor, String(request.params.id), body.targetId, body.confirmation);
    try {
      await accessChanged();
    } catch {
      throw new AuthError(
        503,
        'Ownership transferred, but open connections could not refresh. Refresh accounts to see the result.',
      );
    }
    response.sendStatus(204);
  });
  router.post('/admin/users/:id/passkeys/:key/remove', async (request, response) => {
    admin.removePasskey(
      requireAdmin(request).user_id!,
      String(request.params.id),
      String(request.params.key),
    );
    await accessChanged();
    response.sendStatus(204);
  });
  router.get('/invites', (request, response) => {
    requireAdmin(request);
    response.json({ invites: invites.list() });
  });
  router.get('/invites/recipients', (request, response) => {
    requireAdmin(request);
    response.json({
      users: store.database
        .prepare(
          'SELECT id,name,is_admin AS isAdmin FROM auth_users WHERE disabled=0 ORDER BY name,id',
        )
        .all(),
    });
  });
  router.post('/invites', (request, response) => {
    const admin = requireAdmin(request);
    const { hours = 168, recoveryUserId } = request.body ?? {};
    if (
      typeof hours !== 'number' ||
      (recoveryUserId !== undefined && typeof recoveryUserId !== 'string')
    )
      throw new AuthError(400, 'Invalid invite settings.');
    response.status(201).json(invites.create(admin.user_id!, hours, recoveryUserId));
  });
  router.post('/invites/:id/revoke', (request, response) => {
    requireAdmin(request);
    invites.revoke(String(request.params.id));
    response.sendStatus(204);
  });
  router.post('/invite/details', (request, response) => {
    response.json(invites.details(request.body?.token));
  });
  router.post('/invite/options', async (request, response) => {
    const token = request.body?.token;
    invites.active(token);
    store.checkCapacity();
    let session = store.session(cookieToken(request));
    if (!session) {
      const created = store.createSession(null);
      session = created.session;
      setSessionCookie(response, created.token, session.expires_at);
    }
    response.json(await invites.options(session, token, request.body?.name));
  });
  router.post('/invite/verify', async (request, response) => {
    const body = payload(request);
    const result = await invites.accept(
      requireSession(request),
      request.body.token,
      body.challengeId,
      body.response,
    );
    setSessionCookie(response, result.token, result.session.expires_at);
    response.json({ redirect: result.user.is_admin ? '/admin' : '/' });
  });
  router.post('/recover-admin/details', (request, response) => {
    const id = request.body?.setupId;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id))
      throw new AuthError(400, 'Open the recovery link printed on the server.');
    response.json({ name: recovery.active(id).user.name });
  });
  router.post('/recover-admin/options', async (request, response) => {
    const id = request.body?.setupId;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id))
      throw new AuthError(400, 'Open the recovery link printed on the server.');
    recovery.active(id);
    store.checkCapacity();
    let session = store.session(cookieToken(request));
    if (!session) {
      const created = store.createSession(null);
      session = created.session;
      setSessionCookie(response, created.token, session.expires_at);
    }
    response.json(await recovery.options(session, id));
  });
  router.post('/recover-admin/verify', async (request, response) => {
    const body = payload(request);
    if (typeof request.body.setupId !== 'string' || typeof request.body.proof !== 'string')
      throw new AuthError(400, 'Invalid recovery response.');
    const result = await recovery.claim(
      requireSession(request),
      request.body.setupId,
      body.challengeId,
      body.response,
      request.body.proof,
    );
    setSessionCookie(response, result.token, result.session.expires_at);
    response.json({ redirect: '/admin' });
  });
  router.post('/setup/options', async (request, response) => {
    const id = request.body?.setupId;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(id))
      throw new AuthError(400, 'Open the setup link printed on the server.');
    setup.active(id);
    store.checkCapacity();
    let session = store.session(cookieToken(request));
    if (!session) {
      const created = store.createSession(null);
      session = created.session;
      setSessionCookie(response, created.token, session.expires_at);
    }
    response.json(await setup.options(session, id));
  });
  router.post('/setup/verify', async (request, response) => {
    const body = payload(request);
    if (typeof request.body.setupId !== 'string' || typeof request.body.proof !== 'string')
      throw new AuthError(400, 'Invalid setup response.');
    const result = await setup.claim(
      requireSession(request),
      request.body.setupId,
      body.challengeId,
      body.response,
      request.body.proof,
    );
    setSessionCookie(response, result.token, result.session.expires_at);
    response.json({ redirect: '/admin' });
  });
  router.post('/authentication/options', async (request, response) => {
    store.checkCapacity();
    let session = store.session(cookieToken(request));
    if (!session) {
      const created = store.createSession(null);
      session = created.session;
      setSessionCookie(response, created.token, session.expires_at);
    }
    response.json(await service.authenticationOptions(session));
  });
  router.post('/registration/options', async (request, response) => {
    response.json(await service.registrationOptions(requireSession(request, true)));
  });
  function payload(request: Request) {
    const body = request.body;
    if (
      !body ||
      typeof body.challengeId !== 'string' ||
      !/^[\w-]{43}$/.test(body.challengeId) ||
      !body.response ||
      typeof body.response.id !== 'string' ||
      !body.response.response
    ) {
      throw new AuthError(400, 'Invalid passkey response. Try again.');
    }
    return body as {
      challengeId: string;
      response: RegistrationResponseJSON & AuthenticationResponseJSON;
    };
  }
  router.post('/registration/verify', async (request, response) => {
    const body = payload(request);
    response.json(
      await service.register(requireSession(request, true), body.challengeId, body.response),
    );
  });
  router.post('/authentication/verify', async (request, response) => {
    const body = payload(request);
    const result = await service.authenticate(
      requireSession(request),
      body.challengeId,
      body.response,
    );
    setSessionCookie(response, result.token, result.session.expires_at);
    response.json({ redirect: result.user.is_admin ? '/admin' : '/' });
  });
  router.post('/cancel', (request, response) => {
    const session = store.session(cookieToken(request));
    if (session && typeof request.body?.challengeId === 'string')
      store.cancel(request.body.challengeId, session);
    response.sendStatus(204);
  });
  router.post('/sign-out', (request, response) => {
    const session = store.session(cookieToken(request));
    if (session) store.revokeSession(session.token_hash);
    response.clearCookie(COOKIE_NAME, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/',
    });
    response.sendStatus(204);
  });
  router.get('/passkeys', (request, response) => {
    const session = requireSession(request, true);
    response.json({
      passkeys: store
        .passkeys(session.user_id!)
        .map(({ id, name, provider, created_at, last_used_at }) => ({
          id,
          name,
          provider,
          createdAt: created_at,
          lastUsedAt: last_used_at,
        })),
    });
  });
  router.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    const status = error instanceof AuthError ? error.status : 400;
    response
      .status(status)
      .json({ error: error instanceof AuthError ? error.message : 'Invalid request. Try again.' });
  });
  return router;
}
