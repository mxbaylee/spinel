import { expect, test } from 'vitest';
import {
  needsServer,
  parseShellManifest,
  runtimeDescriptor,
  shellFiles,
  SHELL_PLACEHOLDER,
} from './offlineShell.ts';
import type { ShellManifest } from './offlineShell.ts';

const manifest: ShellManifest = {
  protocol: 1,
  version: '0123456789abcdef',
  compatibility: { format: 1, sdkVersion: '1.1.0' },
  entry: '/assets/application-abc.js',
  css: ['/assets/theme-def.css'],
  files: ['/assets/application-abc.js', '/assets/renderer-ghi.js', '/assets/theme-def.css'],
};
test('the shell lists public emitted assets only, without maps, pages, worker or traversal', () => {
  expect(
    shellFiles([
      'index.html',
      'service-worker.js',
      'assets/main-abc.js',
      'assets/main-abc.js.map',
      'assets/index-def.css',
      'assets/nested/file.js',
      'other/file.js',
      'assets/../private.js',
      'assets/file.js?token=x',
    ]),
  ).toEqual(['/assets/index-def.css', '/assets/main-abc.js']);
});
test('development has no manifest; a public production descriptor names a complete application entry', () => {
  expect(parseShellManifest(SHELL_PLACEHOLDER)).toBeNull();
  expect(parseShellManifest(JSON.stringify(manifest))).toEqual(manifest);
  expect(
    runtimeDescriptor(
      `<html><head><script id="spinel-runtime" type="application/json">${JSON.stringify(manifest)}</script></head></html>`,
    ),
  ).toEqual(manifest);
  expect(runtimeDescriptor('<html><head></head></html>')).toBeNull();
});
test.each([
  { protocol: 2 },
  { version: 'short' },
  { compatibility: { format: 0, sdkVersion: '1.1.0' } },
  { compatibility: { format: 1, sdkVersion: 'unknown' } },
  { files: ['/api/items'] },
  { files: ['/assets/../api'] },
  { files: 'nope' },
  { files: [...manifest.files, manifest.files[0]] },
  { entry: '/assets/missing.js' },
  { css: ['/assets/missing.css'] },
  { css: [123] },
])('malformed public runtime metadata is refused: %j', (change) => {
  expect(() => parseShellManifest(JSON.stringify({ ...manifest, ...change }))).toThrow();
});
test.each([
  ['/share/0b7a', true],
  ['/setup', true],
  ['/invite', true],
  ['/', false],
  ['/settings', false],
  ['/sign-in', false],
])('%s needs the server: %s', (path, expected) => expect(needsServer(path)).toBe(expected));
