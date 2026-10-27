import {
  LEGACY_COMPATIBILITY,
  parseShellManifest,
  RUNTIME_MESSAGE,
  sameCompatibility,
} from '../../src/shared/offlineShell.ts';
import type {
  AccountRuntimeRequirement,
  RuntimeCommand,
  RuntimeCompatibility,
  RuntimeReply,
  ShellManifest,
} from '../../src/shared/offlineShell.ts';
export type {
  AccountRuntimeRequirement,
  RuntimeCompatibility,
} from '../../src/shared/offlineShell.ts';

export type RuntimeHost = {
  manifest: ShellManifest | null;
  compatibility: RuntimeCompatibility;
  switchTo(manifest: ShellManifest, verifyCurrent: () => void): Promise<void>;
};
declare global {
  interface Window {
    __spinelRuntimeHost?: RuntimeHost;
  }
}
export function installRuntimeHost(host: RuntimeHost) {
  window.__spinelRuntimeHost = host;
}
export function currentRuntime() {
  return typeof window === 'undefined' ? undefined : window.__spinelRuntimeHost;
}
/** Compatible online recovery does not require that every public asset remains cached. */
export function isRuntimeCompatible(compatibility: RuntimeCompatibility) {
  return sameCompatibility(currentRuntime()?.compatibility ?? LEGACY_COMPATIBILITY, compatibility);
}

function bounded<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function runtimeRequest(
  type: RuntimeCommand['type'],
  buildId: string,
  accountId?: string,
  requirement?: AccountRuntimeRequirement,
  ms = 3000,
): Promise<Extract<RuntimeReply, { ok: true }>> {
  if (!('serviceWorker' in navigator) || !window.isSecureContext)
    throw new Error('This browser cannot keep Spinel offline.');
  // Registration/ready have no late mutations in this caller. Replies are retired
  // by closing their exclusive message port; expired queued worker commands cannot write.
  const registration = await bounded(
    navigator.serviceWorker.ready,
    3000,
    'Offline app storage did not respond.',
  );
  const worker = registration.active;
  if (!worker) throw new Error('Offline app storage is unavailable.');
  const request: RuntimeCommand = {
    protocol: 1,
    id: crypto.randomUUID(),
    deadline: Date.now() + ms,
    type,
    buildId,
    accountId,
    requirement,
  };
  const channel = new MessageChannel();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const reply = new Promise<RuntimeReply>((resolve, reject) => {
    channel.port1.onmessage = (event) => resolve(event.data as RuntimeReply);
    channel.port1.onmessageerror = () => reject(new Error('Offline app storage did not respond.'));
    // The worker's deadline precedes local retirement, including fetch cancellation.
    timer = setTimeout(
      () => reject(new Error('Offline app storage took too long. Try again.')),
      ms + 1000,
    );
  });
  worker.postMessage({ type: RUNTIME_MESSAGE, request }, [channel.port2]);
  try {
    const result = await reply;
    if (!result || result.ok !== true)
      throw new Error(result?.error ?? 'Offline app storage is unavailable.');
    if (result.manifest) parseShellManifest(JSON.stringify(result.manifest));
    return result;
  } finally {
    clearTimeout(timer);
    channel.port1.close();
  }
}

export type RuntimeAdmission =
  | { kind: 'ready'; buildId: string }
  | { kind: 'switching' }
  | {
      kind: 'unavailable';
      reason: 'unknown-format' | 'missing-compatible-runtime' | 'storage-unavailable';
    };

export async function ensureAccountRuntime(
  accountId: string,
  requirement: AccountRuntimeRequirement,
  verifyCurrent: () => void,
): Promise<RuntimeAdmission> {
  verifyCurrent();
  if (requirement.kind === 'unknown') return { kind: 'unavailable', reason: 'unknown-format' };
  const host = currentRuntime();
  if (!host?.manifest) {
    return requirement.kind === 'empty' || isRuntimeCompatible(requirement.compatibility)
      ? { kind: 'ready', buildId: 'development' }
      : { kind: 'unavailable', reason: 'missing-compatible-runtime' };
  }
  if (requirement.kind === 'empty') {
    // The caller proved emptiness while holding the account catalog lock. A
    // crashed preparation may have reserved public compatibility before its
    // private transaction committed; retire only that account's stale hold.
    await releaseAccountRuntime(accountId, verifyCurrent).catch(() => verifyCurrent());
    return { kind: 'ready', buildId: host.manifest.version };
  }
  try {
    const answer = await runtimeRequest('admit', host.manifest.version, accountId, requirement);
    verifyCurrent();
    if (!answer.manifest)
      return {
        kind: 'unavailable',
        reason:
          answer.reason === 'unknown-format' ? 'unknown-format' : 'missing-compatible-runtime',
      };
    if (
      answer.manifest.version === host.manifest.version &&
      sameCompatibility(answer.manifest.compatibility, requirement.compatibility)
    )
      return { kind: 'ready', buildId: answer.manifest.version };
    await host.switchTo(answer.manifest, verifyCurrent);
    return { kind: 'switching' };
  } catch {
    verifyCurrent();
    return { kind: 'unavailable', reason: 'storage-unavailable' };
  }
}

export async function releaseAccountRuntime(accountId: string, verifyCurrent: () => void) {
  verifyCurrent();
  const manifest = currentRuntime()?.manifest;
  if (!manifest) return;
  await runtimeRequest('release', manifest.version, accountId);
  verifyCurrent();
}

export type RuntimeReadiness =
  | { kind: 'ready'; buildId: string; compatibility: RuntimeCompatibility }
  | { kind: 'not-prepared' }
  | {
      kind: 'unavailable';
      reason:
        'missing-cache' | 'incomplete-cache' | 'missing-compatible-runtime' | 'storage-unavailable';
    };
export async function accountRuntimeReadiness(
  accountId: string,
  verifyCurrent: () => void,
): Promise<RuntimeReadiness> {
  verifyCurrent();
  const manifest = currentRuntime()?.manifest;
  if (!manifest) return { kind: 'not-prepared' };
  try {
    const answer = await runtimeRequest('readiness', manifest.version, accountId);
    verifyCurrent();
    if (answer.prepared && answer.manifest)
      return {
        kind: 'ready',
        buildId: answer.manifest.version,
        compatibility: answer.manifest.compatibility,
      };
    if (!answer.reason) return { kind: 'not-prepared' };
    return {
      kind: 'unavailable',
      reason:
        answer.reason === 'missing-cache' || answer.reason === 'incomplete-cache'
          ? answer.reason
          : 'missing-compatible-runtime',
    };
  } catch {
    verifyCurrent();
    return { kind: 'unavailable', reason: 'storage-unavailable' };
  }
}
