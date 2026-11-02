import { palettes } from '../ui/palette.ts';

/** Fixed public installation metadata; never includes an account or entry URL. */
export const pwaManifest = {
  id: '/',
  name: 'Spinel',
  short_name: 'Spinel',
  description: 'Your private workspace for documents and spreadsheets.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: palettes.light['sp-bg'],
  theme_color: palettes.light['sp-rail'],
  icons: [192, 512].map((size) => ({
    src: `/app-icon-${size}.png`,
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose: 'any maskable',
  })),
};

export const installationPaths = [
  '/manifest.webmanifest',
  '/app-icon-180.png',
  '/app-icon-192.png',
  '/app-icon-512.png',
] as const;
export type InstallationPath = (typeof installationPaths)[number];
export const isInstallationPath = (path: string): path is InstallationPath =>
  installationPaths.some((candidate) => candidate === path);

export function installationAssetName(path: InstallationPath, digest: string) {
  const name = path === '/manifest.webmanifest' ? 'manifest' : path.slice(1, -4);
  const extension = path === '/manifest.webmanifest' ? 'webmanifest' : 'png';
  return `/assets/install-${name}-${digest}.${extension}`;
}

/** Hash-addressed public bytes bind installation assets to the emitted runtime. */
export function installationAssetDigest(path: InstallationPath, file: string) {
  const match = file.match(/-([a-f0-9]{64})\.(?:webmanifest|png)$/);
  return match && installationAssetName(path, match[1]) === file ? match[1] : null;
}

/** Retained manifests may use older public copy/colors, but never arbitrary URLs or keys. */
export function validPwaManifest(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  const keys = Object.keys(pwaManifest);
  if (
    Object.keys(manifest).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(manifest, key)) ||
    manifest.id !== '/' ||
    manifest.start_url !== '/' ||
    manifest.scope !== '/' ||
    manifest.display !== 'standalone' ||
    !['name', 'short_name', 'description'].every(
      (key) =>
        typeof manifest[key] === 'string' &&
        manifest[key].length > 0 &&
        manifest[key].length <= 300,
    ) ||
    !['background_color', 'theme_color'].every(
      (key) => typeof manifest[key] === 'string' && /^#[a-f0-9]{6}$/i.test(manifest[key]),
    ) ||
    !Array.isArray(manifest.icons) ||
    manifest.icons.length !== 2
  )
    return false;
  return manifest.icons.every((entry: unknown, index: number) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const icon = entry as Record<string, unknown>;
    const size = [192, 512][index];
    return (
      Object.keys(icon).sort().join(',') === 'purpose,sizes,src,type' &&
      icon.src === `/app-icon-${size}.png` &&
      icon.sizes === `${size}x${size}` &&
      icon.type === 'image/png' &&
      icon.purpose === 'any maskable'
    );
  });
}
