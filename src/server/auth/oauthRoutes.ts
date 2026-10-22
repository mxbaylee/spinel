import { Router } from 'express';
import {
  createOAuthMetadata,
  mcpAuthMetadataRouter,
  mcpAuthRouter,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { AssistantOAuth, MCP_SCOPES } from './oauth.ts';

export function assistantOAuthRoutes(provider: AssistantOAuth) {
  const options = {
    provider,
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
