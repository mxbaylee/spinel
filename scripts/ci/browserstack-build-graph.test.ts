import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  inspectBuildGraph,
  inspectFinalBuild,
  sha256,
  validateRendererBoundary,
} from './browserstack-build-graph.ts';
import { installationAssetName, installationPaths } from '../../src/shared/pwa.ts';

const chunk = (fileName: string, imports: string[] = [], dynamicImports: string[] = []) => ({
  type: 'chunk' as const,
  fileName,
  name: fileName === 'application.js' ? 'application' : fileName,
  isEntry: fileName === 'application.js',
  imports,
  dynamicImports,
  modules: { ['/repo/web/' + fileName]: { renderedLength: 300 } },
});
const fixture = () => ({
  'application.js': chunk('application.js', ['shared.js'], ['editor.js']),
  'shared.js': chunk('shared.js', ['application.js']),
  'editor.js': chunk('editor.js', ['shared.js']),
  'app.css': { type: 'asset' as const, fileName: 'app.css' },
});

test('actual emitted bytes bind a deduplicated static closure, excluding dynamic-only chunks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spn090-build-'));
  try {
    const bundle = fixture();
    for (const file of Object.keys(bundle)) await writeFile(join(directory, file), file);
    const inspect = () =>
      inspectBuildGraph(bundle, (file) => readFile(join(directory, file)), '/repo');
    const result = await inspect();
    assert.deepEqual(result.staticJavaScriptClosure, ['application.js', 'shared.js']);
    assert.equal(result.staticBytes, Buffer.byteLength('application.jsshared.js'));
    assert.equal(
      result.files.find((row) => row.file === 'editor.js')?.initialApplicationDependency,
      false,
    );
    assert.deepEqual(result.files.find((row) => row.file === 'application.js')?.modules, [
      { id: 'web/application.js', renderedLength: 300 },
    ]);
    await writeFile(join(directory, 'shared.js'), 'changed emitted bytes');
    const changed = await inspect();
    assert.equal(
      changed.files.find((row) => row.file === 'shared.js')?.sha256,
      sha256('changed emitted bytes'),
    );
    assert.notEqual(changed.staticBytes, result.staticBytes);
    await rm(join(directory, 'editor.js'));
    await assert.rejects(inspect(), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('final settled files bind descriptor CSS, copied assets, and unchanged declared bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'spn090-final-build-'));
  try {
    await mkdir(join(directory, 'assets'));
    const installation = Object.fromEntries(
      installationPaths.map((path) => [path, installationAssetName(path, sha256(path))]),
    );
    const descriptor = {
      protocol: 1,
      version: 'a'.repeat(16),
      compatibility: { format: 1, sdkVersion: '1.1.0' },
      entry: '/assets/application.js',
      css: ['/assets/editor.css'],
      files: [
        '/assets/application.js',
        '/assets/editor.css',
        ...Object.values(installation),
      ].sort(),
      installation,
    };
    const html = (await readFile('web/index.html', 'utf8'))
      .replace('/main.tsx', '/assets/application.js')
      .replace(
        '</head>',
        `<script id="spinel-runtime" type="application/json">${JSON.stringify(descriptor)}</script></head>`,
      );
    const values = {
      'index.html': html,
      'service-worker.js': 'worker',
      'assets/application.js': 'app',
      'assets/editor.css': 'editor CSS',
      'copied.txt': 'public copy',
      ...Object.fromEntries(installationPaths.map((path) => [installation[path].slice(1), path])),
    };
    for (const [file, value] of Object.entries(values))
      await writeFile(join(directory, file), value);
    const bundle = {
      'index.html': { type: 'asset' as const, fileName: 'index.html' },
      'service-worker.js': chunk('service-worker.js'),
      'assets/application.js': {
        ...chunk('assets/application.js'),
        name: 'application',
        isEntry: true,
      },
      'assets/editor.css': { type: 'asset' as const, fileName: 'assets/editor.css' },
    };
    const hashes = Object.fromEntries(
      Object.entries(values).map(([file, value]) => [file, sha256(value)]),
    );
    const inspect = () => inspectFinalBuild(directory, bundle, '/repo', hashes);
    const result = await inspect();
    assert.equal(result.complete, true);
    assert.deepEqual(result.staticJavaScriptClosure, ['assets/application.js']);
    assert.deepEqual(result.preRenderStylesheets, ['/assets/editor.css']);
    assert.deepEqual(
      result.htmlEntrypoints.find((row) => row.href === '/favicon.ico?v=2'),
      {
        href: '/favicon.ico?v=2',
        pathname: '/favicon.ico',
        owner: 'server-pwa-route',
        emitted: null,
      },
    );
    assert.equal(
      result.htmlEntrypoints.find((row) => row.href === '/manifest.webmanifest')?.emitted,
      installation['/manifest.webmanifest'],
    );
    assert.equal(
      result.finalFiles.find((row) => row.file === 'copied.txt')?.copiedOutsideBundle,
      true,
    );
    await writeFile(join(directory, 'assets/application.js'), 'changed');
    await assert.rejects(inspect(), /Changed final emitted member/);
    await writeFile(join(directory, 'assets/application.js'), 'app');
    const wrongHtml = html.replaceAll('/assets/application.js', '/assets/missing.js');
    await writeFile(join(directory, 'index.html'), wrongHtml);
    hashes['index.html'] = sha256(wrongHtml);
    await assert.rejects(inspect(), /descriptor entry mismatch/);
    await writeFile(join(directory, 'index.html'), html);
    hashes['index.html'] = sha256(html);
    const missingScript = html.replace(
      'src="/assets/application.js"',
      'src="/assets/missing.js?v=2"',
    );
    await writeFile(join(directory, 'index.html'), missingScript);
    hashes['index.html'] = sha256(missingScript);
    await assert.rejects(inspect(), /Missing HTML entry asset/);
    await writeFile(join(directory, 'index.html'), html);
    hashes['index.html'] = sha256(html);
    await writeFile(join(directory, installation['/manifest.webmanifest'].slice(1)), 'tampered');
    await assert.rejects(inspect(), /installation alias target/);
    await writeFile(
      join(directory, installation['/manifest.webmanifest'].slice(1)),
      '/manifest.webmanifest',
    );
    await symlink('/etc/hosts', join(directory, 'escaped'));
    await assert.rejects(inspect(), /Symlink/);
    await rm(join(directory, 'escaped'));
    await rm(join(directory, 'assets/editor.css'));
    await assert.rejects(inspect(), /Missing final emitted member/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing entry, unresolved static or dynamic dependencies and unsafe paths fail closed', async () => {
  const read = async (file: string) => Buffer.from(file);
  await assert.rejects(inspectBuildGraph({}, read, '/repo'), /file count/);
  await assert.rejects(
    inspectBuildGraph({ 'other.js': chunk('other.js') }, read, '/repo'),
    /application entry/,
  );
  for (const dynamic of [false, true]) {
    const bundle = fixture();
    if (dynamic) bundle['application.js'].dynamicImports.push('missing.js');
    else bundle['application.js'].imports.push('missing.js');
    await assert.rejects(inspectBuildGraph(bundle, read, '/repo'), /Missing emitted dependency/);
  }
  for (const path of [
    '../escape.js',
    '/absolute.js',
    'a/../escape.js',
    'a\\escape.js',
    './alias.js',
  ])
    await assert.rejects(
      inspectBuildGraph({ ...fixture(), [path]: chunk(path) }, read, '/repo'),
      /emitted path/,
    );
  await assert.rejects(
    inspectBuildGraph({ ...fixture(), 'alias.js': chunk('shared.js') }, read, '/repo'),
    /conflicting emitted path/,
  );
});

test('renderer boundary rejects eager imports and missing dictionary, shell or editor reachability', () => {
  const modules = [
    'node_modules/@univerjs/engine-render/dictionary.js',
    'node_modules/@univerjs/engine-render/index.js',
  ];
  const fixture = () => ({
    files: [
      {
        file: 'renderer.js',
        type: 'chunk',
        initialApplicationDependency: false,
        modules: modules.map((id) => ({ id })),
        imports: [],
        dynamicImports: [],
      },
      ...['DocEditor', 'SheetEditor'].map((name) => ({
        file: name + '.js',
        type: 'chunk',
        initialApplicationDependency: false,
        modules: [{ id: 'web/' + name + '.tsx' }],
        imports: ['renderer.js'],
        dynamicImports: [],
      })),
    ],
    descriptor: { files: ['/renderer.js'] },
  });
  assert.equal(validateRendererBoundary(fixture() as any, modules).passed, true);
  const eager = fixture();
  eager.files[0].initialApplicationDependency = true;
  assert.throws(() => validateRendererBoundary(eager as any, modules), /still imports renderer/);
  const missing = fixture();
  missing.files[0].modules.pop();
  assert.throws(() => validateRendererBoundary(missing as any, modules), /inventory changed/);
  const offline = fixture();
  offline.descriptor.files = [];
  assert.throws(() => validateRendererBoundary(offline as any, modules), /offline shell/);
  const editor = fixture();
  editor.files[1].imports = [];
  assert.throws(() => validateRendererBoundary(editor as any, modules), /lost renderer/);
});
