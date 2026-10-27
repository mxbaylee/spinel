import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { assertNoUniverPro } from './no-univer-pro.ts';

function fixture(run: (directory: string, write: (path: string, value: unknown) => void) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'spinel-no-pro-'));
  const write = (path: string, value: unknown) => {
    const file = join(directory, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  };
  write('package.json', {
    workspaces: ['packages/*'],
    dependencies: { '@univerjs/core': '1.1.0' },
  });
  write('packages/editor/package.json', { dependencies: { '@univerjs/sheets': '1.1.0' } });
  write('package-lock.json', { lockfileVersion: 3, packages: { '': {}, 'packages/editor': {} } });
  try {
    run(directory, write);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('clean root and declared workspaces pass without an installed dependency tree', () => {
  fixture((directory) => assert.equal(assertNoUniverPro(directory), 2));
});

for (const field of [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'overrides',
  'resolutions',
]) {
  test(`rejects a direct Pro package in ${field}`, () => {
    fixture((directory, write) => {
      write('package.json', { [field]: { '@univerjs-pro/license': '1.1.0' } });
      assert.throws(() => assertNoUniverPro(directory), /package.json.*@univerjs-pro\/license/);
    });
  });
}

test('inspects every declared workspace instead of assuming the current lib directory', () => {
  fixture((directory, write) => {
    write('packages/editor/package.json', {
      optionalDependencies: { '@univerjs-pro/license': '*' },
    });
    assert.throws(() => assertNoUniverPro(directory), /packages\/editor\/package.json/);
    write('packages/editor/package.json', { name: '@univerjs-pro/license', version: '1.1.0' });
    assert.throws(() => assertNoUniverPro(directory), /packages\/editor\/package.json.name/);
  });
});

test('rejects direct and nested aliases plus bundled package names', () => {
  for (const manifest of [
    { dependencies: { innocent: 'npm:@univerjs-pro/license@1.1.0' } },
    { overrides: { innocent: { nested: 'npm:@univerjs-pro/license@1.1.0' } } },
    { bundledDependencies: ['@univerjs-pro/license'] },
    { bundleDependencies: ['@univerjs-pro/license'] },
  ]) {
    fixture((directory, write) => {
      write('package.json', manifest);
      assert.throws(() => assertNoUniverPro(directory), /Univer Pro dependencies are prohibited/);
    });
  }
});

test('rejects transitive, nested and aliased resolved packages with no direct declaration', () => {
  for (const packages of [
    { 'node_modules/@univerjs-pro/license': { version: '1.1.0' } },
    { 'node_modules/parent/node_modules/@univerjs-pro/license': { version: '1.1.0' } },
    { 'node_modules/innocent': { name: '@univerjs-pro/license', version: '1.1.0' } },
    { 'node_modules/parent': { dependencies: { alias: 'npm:@univerjs-pro/license@1.1.0' } } },
    { 'node_modules/alias': { resolved: 'https://registry.npmjs.org/%40univerjs-pro%2Flicense' } },
  ]) {
    fixture((directory, write) => {
      write('package-lock.json', { lockfileVersion: 3, packages });
      assert.throws(() => assertNoUniverPro(directory), /package-lock.json/);
    });
  }
});

test('missing resolved inventory fails closed; descriptive provenance is not a dependency', () => {
  fixture((directory, write) => {
    write('package.json', { description: 'Replaces @univerjs-pro/collaboration.' });
    assert.equal(assertNoUniverPro(directory), 1);
    write('package-lock.json', { lockfileVersion: 3 });
    assert.throws(() => assertNoUniverPro(directory), /resolved npm package inventory/);
    write('package-lock.json', { lockfileVersion: 3, packages: [] });
    assert.throws(() => assertNoUniverPro(directory), /resolved npm package inventory/);
  });
});
