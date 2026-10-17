import type { RegistrationResponseJSON } from '@simplewebauthn/browser';
import { setupProofMessage } from '../src/shared/setup-proof.ts';

export async function signSetupProof(
  secret: string,
  id: string,
  challenge: string,
  response: RegistrationResponseJSON,
) {
  const binary = atob(secret.replaceAll('-', '+').replaceAll('_', '/'));
  const der = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
  const signature = await crypto.subtle.sign(
    'Ed25519',
    key,
    new TextEncoder().encode(setupProofMessage(location.origin, id, challenge, response)),
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
