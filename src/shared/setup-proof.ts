// Domain-separated proof binds console-key possession to this exact ceremony.
// Only public fields and a signature cross the network; the private key stays in the browser.
export function setupProofMessage(
  origin: string,
  setupId: string,
  challenge: string,
  response: {
    id: string;
    response: { attestationObject: string; clientDataJSON: string };
  },
  recovery = false,
) {
  return JSON.stringify([
    recovery ? 'spinel/admin-recovery/v1' : 'spinel/setup/v1',
    origin,
    setupId,
    challenge,
    response.id,
    response.response.attestationObject,
    response.response.clientDataJSON,
  ]);
}
