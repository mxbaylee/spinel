import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { AuthError, AuthStore, COOKIE_NAME } from './store.ts';
import { AuthService } from './service.ts';
import type { Session } from './store.ts';

export function cookieToken(request: Request) {
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
export function authRoutes(store: AuthStore, origin: string) {
  const router = express.Router();
  const service = new AuthService(store, origin);
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
  router.get('/session', (request, response) => {
    const session = requireSession(request, true);
    const user = store.user(session.user_id!)!;
    response.json({ user: { id: user.id, name: user.name, isAdmin: Boolean(user.is_admin) } });
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
