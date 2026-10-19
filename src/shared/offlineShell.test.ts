import { expect, test } from 'vitest';
import { needsServer, parseShellManifest, shellFiles, SHELL_PLACEHOLDER } from './offlineShell.ts';

test('the shell lists hashed assets only, sorted, without maps, pages or the worker', () => {
  expect(
    shellFiles([
      'index.html',
      'service-worker.js',
      'assets/main-abc.js',
      'assets/main-abc.js.map',
      'assets/index-def.css',
      'assets/nested/file.js',
      'other/file.js',
    ]),
  ).toEqual(['/assets/index-def.css', '/assets/main-abc.js']);
});

test('development has no manifest; a build manifest must be well formed', () => {
  expect(parseShellManifest(SHELL_PLACEHOLDER)).toBeNull();
  const manifest = { version: '0123456789abcdef', files: ['/assets/main-abc.js'] };
  expect(parseShellManifest(JSON.stringify(manifest))).toEqual(manifest);
  for (const bad of [
    { ...manifest, version: 'short' },
    { ...manifest, files: ['/api/items'] },
    { ...manifest, files: ['/assets/../api'] },
    { ...manifest, files: 'nope' },
  ])
    expect(() => parseShellManifest(JSON.stringify(bad))).toThrow(/malformed/);
});

// Link guests and one-time setup/invite pages never get the private shell offline.
test.each([
  ['/share/0b7a', true],
  ['/setup', true],
  ['/invite', true],
  ['/', false],
  ['/settings', false],
  ['/sign-in', false],
])('%s needs the server: %s', (path, expected) => {
  expect(needsServer(path)).toBe(expected);
});
