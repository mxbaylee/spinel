/** Public runtime metadata only. No document, session or entry token belongs here. */
export type RuntimeCompatibility = { format: number; sdkVersion: string };
export type ShellManifest = {
  protocol: 1;
  version: string;
  compatibility: RuntimeCompatibility;
  entry: string;
  css: string[];
  files: string[];
};
export type AccountRuntimeRequirement =
  | { kind: 'empty' }
  | { kind: 'retained'; compatibility: RuntimeCompatibility }
  | { kind: 'unknown' };

export type RuntimeCommand = {
  protocol: 1;
  id: string;
  deadline: number;
  type: 'bootstrap' | 'claim' | 'admit' | 'prepare' | 'readiness' | 'release';
  buildId: string;
  accountId?: string;
  requirement?: AccountRuntimeRequirement;
};
export type RuntimeReply =
  | { ok: true; manifest?: ShellManifest; prepared?: boolean; reason?: string }
  | { ok: false; error: string };
export type PrepareShellReply = { ok: true; version: string } | { ok: false; error: string };

export const PREPARE_SHELL = 'spinel-prepare-shell';
export const RUNTIME_MESSAGE = 'spinel-runtime';
export const SHELL_CACHE_PREFIX = 'spinel-shell-';
export const SHELL_PLACEHOLDER = '__SPINEL_SHELL_MANIFEST__';
export const SHELL_PAGE = '/';
export const RUNTIME_DESCRIPTOR_ID = 'spinel-runtime';
export const LEGACY_COMPATIBILITY: RuntimeCompatibility = { format: 1, sdkVersion: '1.1.0' };

export function sameCompatibility(left: RuntimeCompatibility, right: RuntimeCompatibility) {
  return left.format === right.format && left.sdkVersion === right.sdkVersion;
}
export function validCompatibility(value: unknown): value is RuntimeCompatibility {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as RuntimeCompatibility;
  return (
    Number.isSafeInteger(candidate.format) &&
    candidate.format > 0 &&
    typeof candidate.sdkVersion === 'string' &&
    /^[\d]+\.[\d]+\.[\d]+(?:[-+][\w.-]+)?$/.test(candidate.sdkVersion)
  );
}
export const isShellAsset = (path: string) =>
  /^\/assets\/[\w.-]+$/.test(path) && !path.endsWith('.map');
export function shellFiles(fileNames: readonly string[]) {
  return fileNames
    .map((name) => `/${name}`)
    .filter(isShellAsset)
    .sort();
}

/** Returns null only for an unbuilt development placeholder. */
export function parseShellManifest(text: string): ShellManifest | null {
  if (!text.startsWith('{')) return null;
  const value = JSON.parse(text) as ShellManifest;
  if (
    value.protocol !== 1 ||
    !/^[a-f0-9]{16}$/.test(value.version) ||
    !validCompatibility(value.compatibility) ||
    !Array.isArray(value.files) ||
    !value.files.length ||
    value.files.some((file) => typeof file !== 'string' || !isShellAsset(file)) ||
    new Set(value.files).size !== value.files.length ||
    typeof value.entry !== 'string' ||
    !value.entry.endsWith('.js') ||
    !value.files.includes(value.entry) ||
    !Array.isArray(value.css) ||
    new Set(value.css).size !== value.css.length ||
    value.css.some(
      (file) => typeof file !== 'string' || !file.endsWith('.css') || !value.files.includes(file),
    )
  )
    throw new Error('The offline app shell manifest is malformed.');
  return value;
}

export function runtimeDescriptor(html: string): ShellManifest | null {
  const match = html.match(
    /<script\s+id="spinel-runtime"\s+type="application\/json">([^<]*)<\/script>/,
  );
  return match ? parseShellManifest(match[1]) : null;
}

/** Guest and one-time account entry pages still require the server. */
export function needsServer(pathname: string) {
  return pathname.startsWith('/share/') || pathname === '/setup' || pathname === '/invite';
}
