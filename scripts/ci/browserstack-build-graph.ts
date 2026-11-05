import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { runtimeDescriptor, shellFiles } from '../../src/shared/offlineShell.ts';
import { installationAssetDigest, isInstallationPath } from '../../src/shared/pwa.ts';
import assert from 'node:assert/strict';

export type BuildMember = {
  type: 'asset' | 'chunk';
  fileName: string;
  name?: string;
  isEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  modules?: Record<string, { renderedLength: number }>;
};

export const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');

// Read emitted bytes, not estimated module lengths, for actual transfer sizes.
// Module lengths identify membership only; shared code and compression are not additive.
export async function inspectBuildGraph(
  bundle: Record<string, BuildMember>,
  read: (file: string) => Promise<Buffer>,
  root: string,
) {
  const files = Object.keys(bundle).sort();
  if (files.length === 0 || files.length > 4096) throw new Error('Invalid emitted file count');
  const validPath = (file: string) =>
    !file.startsWith('/') &&
    !file.includes('\\') &&
    file.split('/').every((part) => part && part !== '..' && part !== '.');
  for (const file of files) {
    if (!validPath(file) || bundle[file].fileName !== file)
      throw new Error('Invalid or conflicting emitted path');
  }
  const entries = files.filter((file) => {
    const member = bundle[file];
    return member.type === 'chunk' && member.isEntry && member.name === 'application';
  });
  if (entries.length !== 1) throw new Error('Expected one application entry');
  const chunks = new Set(files.filter((file) => bundle[file].type === 'chunk'));
  for (const file of chunks) {
    const member = bundle[file];
    for (const edge of [...(member.imports ?? []), ...(member.dynamicImports ?? [])]) {
      if (!chunks.has(edge)) throw new Error(`Missing emitted dependency: ${file} -> ${edge}`);
    }
  }
  const closure = new Set<string>();
  function visit(file: string) {
    if (closure.has(file)) return;
    closure.add(file);
    for (const imported of bundle[file].imports ?? []) visit(imported);
  }
  visit(entries[0]);
  let totalBytes = 0;
  const rows = [];
  for (const file of files) {
    const bytes = await read(file);
    totalBytes += bytes.length;
    if (totalBytes > 256 * 1024 ** 2) throw new Error('Emitted build exceeds inspection bound');
    const member = bundle[file];
    rows.push({
      file,
      type: member.type,
      bytes: bytes.length,
      sha256: sha256(bytes),
      gzipBytes: gzipSync(bytes).length,
      initialApplicationDependency: closure.has(file),
      ...(member.type === 'chunk'
        ? {
            imports: member.imports ?? [],
            dynamicImports: member.dynamicImports ?? [],
            modules: Object.entries(member.modules ?? {}).map(([id, module]) => ({
              id: id.startsWith(root + '/') ? id.slice(root.length + 1) : id,
              renderedLength: module.renderedLength,
            })),
          }
        : {}),
    });
  }
  const initial = rows.filter((row) => row.initialApplicationDependency);
  return {
    applicationEntry: entries[0],
    staticJavaScriptClosure: [...closure].sort(),
    staticBytes: initial.reduce((sum, row) => sum + row.bytes, 0),
    staticGzipBytes: initial.reduce((sum, row) => sum + row.gzipBytes, 0),
    totalBytes,
    files: rows,
  };
}

export function validateRendererBoundary(
  graph: Awaited<ReturnType<typeof inspectFinalBuild>>,
  expectedModules: string[],
) {
  const chunks = graph.files.filter((row) => row.type === 'chunk');
  const renderer = chunks.filter((row) =>
    row.modules?.some((module) => module.id.includes('node_modules/@univerjs/engine-render/')),
  );
  assert.ok(renderer.length > 0, 'Renderer output missing');
  const modules = [
    ...new Set(
      renderer
        .flatMap((row) => row.modules ?? [])
        .map((module) => module.id)
        .filter((id) => id.includes('node_modules/@univerjs/engine-render/')),
    ),
  ].sort();
  assert.deepEqual(modules, expectedModules, 'Renderer or dictionary module inventory changed');
  assert.ok(
    renderer.every((row) => !row.initialApplicationDependency),
    'Anonymous startup still imports renderer',
  );
  assert.ok(
    renderer.every((row) => graph.descriptor.files.includes('/' + row.file)),
    'Renderer missing from offline shell',
  );
  const editors: Record<string, string[]> = {};
  for (const id of ['web/DocEditor.tsx', 'web/SheetEditor.tsx']) {
    const roots = chunks.filter((row) => row.modules?.some((module) => module.id === id));
    assert.ok(roots.length > 0, `Missing editor entry ${id}`);
    const closure = new Set<string>();
    const visit = (file: string) => {
      if (closure.has(file)) return;
      closure.add(file);
      const row = chunks.find((row) => row.file === file);
      assert.ok(row, 'Missing editor dependency');
      [...(row.imports ?? []), ...(row.dynamicImports ?? [])].forEach(visit);
    };
    roots.forEach((row) => visit(row.file));
    assert.ok(
      renderer.every((row) => closure.has(row.file)),
      `Editor lost renderer/dictionaries ${id}`,
    );
    editors[id] = [...closure].sort();
  }
  return {
    passed: true,
    modules: modules.length,
    chunks: renderer.map((row) => row.file),
    editors,
  };
}

/** Runs only after build() settles; copied public files remain explicit. */
export async function inspectFinalBuild(
  directory: string,
  bundle: Record<string, BuildMember>,
  root: string,
  declaredHashes: Record<string, string>,
) {
  const bytes = new Map<string, Buffer>();
  let totalBytes = 0;
  async function walk(relative = '') {
    for (const name of await readdir(join(directory, relative))) {
      const file = relative ? `${relative}/${name}` : name;
      const status = await lstat(join(directory, file));
      if (status.isSymbolicLink()) throw new Error('Symlink in emitted build');
      if (status.isDirectory()) {
        await walk(file);
        continue;
      }
      if (!status.isFile()) throw new Error('Non-file in emitted build');
      totalBytes += status.size;
      if (bytes.size >= 4096 || totalBytes > 256 * 1024 ** 2)
        throw new Error('Final build exceeds inspection bound');
      const value = await readFile(join(directory, file));
      if (value.length !== status.size) throw new Error('Emitted file changed during inspection');
      bytes.set(file, value);
    }
  }
  if (!(await lstat(directory)).isDirectory() || (await lstat(directory)).isSymbolicLink())
    throw new Error('Invalid emitted build directory');
  await walk();
  const graph = await inspectBuildGraph(
    bundle,
    async (file) => {
      const value = bytes.get(file);
      if (!value) throw new Error(`Missing final emitted member: ${file}`);
      if (sha256(value) !== declaredHashes[file])
        throw new Error(`Changed final emitted member: ${file}`);
      return value;
    },
    root,
  );
  const html = bytes.get('index.html')?.toString('utf8');
  if (!html || !bytes.has('service-worker.js')) throw new Error('Missing HTML or worker');
  const descriptor = runtimeDescriptor(html);
  if (!descriptor || descriptor.entry !== '/' + graph.applicationEntry)
    throw new Error('Final descriptor entry mismatch');
  if (JSON.stringify(descriptor.files) !== JSON.stringify(shellFiles([...bytes.keys()])))
    throw new Error('Final descriptor shell inventory mismatch');
  if (
    JSON.stringify(descriptor.css) !==
    JSON.stringify(descriptor.files.filter((file) => file.endsWith('.css')))
  )
    throw new Error('Final descriptor CSS inventory mismatch');
  const htmlEntrypoints = [...html.matchAll(/<(script|link)\b([^>]*)>/g)].flatMap<{
    href: string;
    pathname: string;
    owner: string;
    emitted: string | null;
  }>((match) => {
    const attributes = Object.fromEntries(
      [...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((attribute) => [
        attribute[1],
        attribute[2],
      ]),
    );
    const href = attributes.src ?? attributes.href;
    if (!href) return [];
    const url = new URL(href, 'https://inspection.invalid');
    if (
      !href.startsWith('/') ||
      href.startsWith('//') ||
      url.origin !== 'https://inspection.invalid' ||
      /[\\\0]/.test(href)
    )
      throw new Error('Unsupported HTML asset URL');
    const pathname = decodeURIComponent(url.pathname);
    const runtime =
      match[1] === 'script' || ['modulepreload', 'stylesheet'].includes(attributes.rel);
    if (runtime) {
      if (!bytes.has(pathname.slice(1))) throw new Error('Missing HTML entry asset');
      return [{ href, pathname, owner: 'emitted-runtime', emitted: pathname }];
    }
    if (isInstallationPath(pathname)) {
      const emitted = descriptor.installation?.[pathname];
      const value = emitted && bytes.get(emitted.slice(1));
      if (!emitted || !value || sha256(value) !== installationAssetDigest(pathname, emitted))
        throw new Error('Missing or changed installation alias target');
      return [{ href, pathname, owner: 'server-route-and-retained-installation-alias', emitted }];
    }
    if (
      attributes.rel === 'icon' &&
      ['/favicon.ico', '/favicon-32.png', '/favicon.svg'].includes(pathname)
    )
      return [{ href, pathname, owner: 'server-pwa-route', emitted: null }];
    throw new Error('Unclassified HTML asset reference');
  });
  return {
    ...graph,
    complete: true,
    descriptor,
    htmlEntrypoints,
    // main.tsx awaits every descriptor CSS file, not just static JS-associated CSS.
    preRenderStylesheets: descriptor.css,
    gzipMeaning:
      'Sum of independently gzip-compressed emitted files, Node zlib defaults; not observed network encoding or evaluation cost',
    moduleLengthMeaning:
      'Bundler rendered-length metadata; not additive transfer or evaluation cost',
    finalFiles: [...bytes].map(([file, value]) => ({
      file,
      bytes: value.length,
      sha256: sha256(value),
      copiedOutsideBundle: !(file in bundle),
    })),
  };
}
