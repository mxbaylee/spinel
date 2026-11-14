import { currentRuntime, runtimeRequest } from './runtime.ts';
import { sameCompatibility } from '../../src/shared/offlineShell.ts';
import type { AccountRuntimeRequirement } from '../../src/shared/offlineShell.ts';

/** Retained for existing bounded read-only startup callers. */
export function within<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Caller owns its account catalog lock through this reservation and private commit. */
export async function prepareShell(
  accountId: string,
  verifyCurrent: () => void,
  requirement: AccountRuntimeRequirement,
) {
  verifyCurrent();
  const host = currentRuntime();
  const manifest = host?.manifest;
  if (!manifest) throw new Error('Offline downloads need a production build of Spinel.');
  const result = await runtimeRequest('prepare', manifest.version, accountId, requirement, 180_000);
  verifyCurrent();
  if (
    !result.prepared ||
    result.manifest?.version !== manifest.version ||
    !sameCompatibility(result.manifest.compatibility, host.compatibility)
  )
    throw new Error('A complete compatible Spinel app could not be kept on this device.');
  return { buildId: manifest.version, compatibility: manifest.compatibility };
}
