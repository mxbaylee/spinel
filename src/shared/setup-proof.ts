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
) {
  return JSON.stringify([
    'spinel/setup/v1',
    origin,
    setupId,
    challenge,
    response.id,
    response.response.attestationObject,
    response.response.clientDataJSON,
  ]);
}
