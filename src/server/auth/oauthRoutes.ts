import { Router } from 'express';
import {
  createOAuthMetadata,
  mcpAuthMetadataRouter,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { AssistantOAuth, MCP_SCOPES } from './oauth.ts';
import type { OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js';

export function assistantOAuthRoutes(provider: AssistantOAuth) {
  // The SDK awaits PKCE work internally rather than returning its handler's
  // promise from Router. Retain each actual provider operation, and reject a
  // disconnected request's later continuation before it can touch a database.
  const admit = <T>(work: () => T): T => {
    const gate = provider.auth.database.maintenance;
    return gate ? gate.run(work) : work();
  };
  const scoped: OAuthServerProvider = {
    clientsStore: {
      getClient: (id) => admit(() => provider.clientsStore.getClient(id)),
      registerClient: (input) => admit(() => provider.clientsStore.registerClient(input)),
    },
    authorize: (...args) => admit(() => provider.authorize(...args)),
    challengeForAuthorizationCode: (...args) =>
      admit(() => provider.challengeForAuthorizationCode(...args)),
    exchangeAuthorizationCode: (...args) =>
      admit(() => provider.exchangeAuthorizationCode(...args)),
    exchangeRefreshToken: (...args) => admit(() => provider.exchangeRefreshToken(...args)),
    verifyAccessToken: (...args) => admit(() => provider.verifyAccessToken(...args)),
    revokeToken: (...args) => admit(() => provider.revokeToken(...args)),
  };
  const options = {
    provider: scoped,
    issuerUrl: new URL(provider.origin),
    resourceServerUrl: new URL(provider.resource),
    scopesSupported: MCP_SCOPES,
    resourceName: 'Spinel',
  };
  const oauthMetadata = createOAuthMetadata(options);
  // SDK defaults include confidential clients; Spinel deliberately registers only public PKCE clients.
  oauthMetadata.token_endpoint_auth_methods_supported = ['none'];
  oauthMetadata.revocation_endpoint_auth_methods_supported = ['none'];
  const router = Router();
  router.use(['/authorize', '/token', '/register', '/revoke'], (_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    response.set('Content-Security-Policy', "frame-ancestors 'none'");
    response.set('X-Frame-Options', 'DENY');
    next();
  });
  router.use(mcpAuthMetadataRouter({ ...options, oauthMetadata }));
  router.use(mcpAuthRouter(options));
  return router;
}
