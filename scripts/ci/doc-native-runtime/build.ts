import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { build as bundle } from 'vite';
import { prepareDocsPatch } from '../../dependencies/patch-univer-docs.ts';
const root = process.cwd(),
  donor = resolve(process.env.SPN146_DEPENDENCY_ROOT ?? root);
const out = resolve(process.env.SPN146_RUNTIME_OUTPUT ?? 'test-results/spn146-native-runtime'),
  here = out + '/source';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
await mkdir(here, { recursive: true });
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (process.env.GITHUB_ACTIONS) assert.equal(source, process.env.SPN146_REVIEWED_HEAD);
const lockBytes = await readFile(root + '/package-lock.json'),
  lock = JSON.parse(lockBytes.toString());
const manifest = JSON.parse(
  await readFile(
    root + '/docs/implementation/evidence/SPN-146/first-hosted-diagnostic/manifest.json',
    'utf8',
  ),
);
async function artifact(name: string) {
  const bytes = gunzipSync(
      await readFile(
        root +
          '/docs/implementation/evidence/SPN-146/runtime-inputs/' +
          name.split('/').at(-1) +
          '.gz',
      ),
      { maxOutputLength: 24 * 1024 ** 2 },
    ),
    identity = manifest.artifactMembers.find((x: any) => x.path === name);
  assert.ok(identity);
  assert.equal(bytes.length, identity.bytes);
  assert.equal(hash(bytes), identity.sha256);
  return JSON.parse(bytes.toString());
}
const build = await artifact('spn146-diagnostic-build.json');
const capturePath = manifest.artifactMembers.find((x: any) =>
  x.path.endsWith('/spn146-native-caches.json'),
).path;
const capture = await artifact(capturePath);
assert.equal(build.source, '1eeb90f1d50291791d39913350c28c672c7154ee');
assert.equal(build.source, build.reviewedHead);
assert.equal(build.tree, '63aff27fd8ce112942db85b9b32eadcfcfaa3762');
assert.equal(hash(lockBytes), build.sources['package-lock.json']);
assert.equal(capture.restored, true);
assert.equal(capture.dropped, 0);
assert.deepEqual(capture.errors, []);
const pairs: any[] = [];
let completed = 0;
for (let i = 0; i < capture.captures.length; i += 2) {
  const history = capture.captures[i],
    collaboration = capture.captures[i + 1];
  assert.equal(history.phase, 'history');
  assert.equal(collaboration.phase, 'collaboration');
  assert.equal(history.count, collaboration.count);
  assert.equal(history.sequence, i);
  assert.equal(collaboration.sequence, i + 1);
  completed += history.count;
  if ([544, 672, 1440, 1984].includes(completed)) {
    assert.equal(history.count, 32);
    pairs.push({
      completed,
      sequences: [i, i + 1],
      history: history.cache,
      collaboration: collaboration.cache,
    });
  }
}
assert.equal(completed, 2086);
assert.deepEqual(
  pairs.map((x) => x.completed),
  [544, 672, 1440, 1984],
);
assert.equal(
  hash(JSON.stringify(pairs)),
  'e7768818642407ee6f559e251f49f9f408fb95e1ba317e1e9d92053134e97fb5',
);
const native: any = {},
  nativeHashes: any = {};
for (const format of ['es', 'cjs'] as const) {
  const bytes = await readFile(
    `${donor}/node_modules/@univerjs/docs/lib/${format}/index.js`,
    'utf8',
  );
  const prepared = prepareDocsPatch(bytes, format),
    record = build.builds.find((x: any) => x.format === format);
  assert.equal(hash(prepared.constantGuardPatched), record.priorSha256);
  // Preserve the first experiment's exact candidate as the upgrade/work control.
  assert.equal(hash(prepared.paragraphTailPatched), record.installedSha256);
  assert.equal(
    hash(prepared.qualifiedRangesPatched),
    {
      es: '110890e889ac362b22a4c38bafd1ebb4e7cf82e8107d4524bdb86ff7fe6bd7c3',
      cjs: '58edceea5e1fb66ff1a83ec0a92707cf6f8d741aab87eb922d9c7e021f99207d',
    }[format],
  );
  assert.equal(
    hash(prepared.linearPrefixPatched),
    {
      es: '4b30f509d7426d43b5314f7d32422e0ca94830320d441712b6eed142af2b8dd5',
      cjs: '4ade808be25d9aed4122d1ab254a07802c89065c06cac42f9dec60fe2f2d286f',
    }[format],
  );
  assert.equal(
    hash(prepared.patched),
    {
      es: 'd77c290c1ac30aba9dad723e61dd88b9d0a0c867f9c29173dafc989f37234de2',
      cjs: '948d12004209a969b98c5a89e030f00167a995fa190278fb67999ef443806103',
    }[format],
  );
  assert.equal(
    hash(await readFile(`${donor}/node_modules/@univerjs/core/lib/${format}/index.js`)),
    build.sources[`node_modules/@univerjs/core/lib/${format}/index.js`],
  );
  const region = (full: string) => {
    const marker = '//#region src/services/doc-state-change-manager.service.ts\n',
      start = full.indexOf(marker),
      end = full.indexOf('//#endregion', start);
    assert.ok(start >= 0 && end > start);
    return full.slice(start, end + '//#endregion'.length);
  };
  native[format] = {
    prior: region(prepared.constantGuardPatched),
    candidate: region(prepared.patched),
  };
  nativeHashes[format] = {
    prior: record.priorSha256,
    candidate: hash(prepared.patched),
    previousCandidate: record.installedSha256,
    previousQualifiedCandidate: hash(prepared.qualifiedRangesPatched),
    previousLinearCandidate: hash(prepared.linearPrefixPatched),
    regions: { prior: hash(native[format].prior), candidate: hash(native[format].candidate) },
  };
}
const test = await readFile(root + '/scripts/dependencies/patch-univer-docs.test.ts', 'utf8');
let fixture = test.slice(test.indexOf('function clock()'), test.indexOf('function apply('));
const replace = (a: string, b: string) => {
  assert.equal(fixture.split(a).length, 2, a);
  fixture = fixture.replace(a, b);
};
replace('const ManagerClass = runInNewContext(', 'const ManagerClass = instantiate(');
// Controlled service sinks keep the native dispatch; cloning/serialization happens after timing.
replace('history.push(structuredClone(entry));', 'history.push(entry);');
replace('changes.push(structuredClone(state));', 'changes.push(state);');
const decode = test.slice(
  test.indexOf('function decodeCapture('),
  test.indexOf('function clock()'),
);
const header = `import * as core from '@univerjs/core';\nimport {BehaviorSubject,Subject,takeUntil} from 'rxjs';\ntype IDocStateChangeInfo=any;type Entry=any;type State=any;type Manager=any;\nconst unitId=${JSON.stringify(capture.unitId)};\nconst native=${JSON.stringify(native)};\nconst pairs=${JSON.stringify(pairs)};\n`;
const body = gunzipSync(
  await readFile(
    root + '/docs/implementation/evidence/SPN-146/local-runtime-abort/source__browser-body.ts.gz',
  ),
).toString();
assert.equal(hash(body), '8950279e7723e36947f03958c140d8a5f9ca31b1f64f74a09f356e1826105874');
const entry =
  test.slice(0, test.indexOf('import assert from')) +
  header +
  body +
  '\n' +
  decode +
  '\n' +
  fixture;
await writeFile(here + '/entry.ts', entry, { flag: 'wx' });
const toolVersions: any[] = [];
for (const name of [
  'vite',
  'playwright',
  'playwright-core',
  '@playwright/test',
  'rxjs',
  '@univerjs/core',
]) {
  const value = JSON.parse(await readFile(`${donor}/node_modules/${name}/package.json`, 'utf8'));
  assert.equal(value.version, lock.packages['node_modules/' + name].version);
  toolVersions.push({ name, version: value.version });
}
const modules = new Set<string>();
await bundle({
  configFile: false,
  root: here,
  logLevel: 'warn',
  resolve: {
    alias: [
      {
        find: /^@univerjs\/core$/,
        replacement: donor + '/node_modules/@univerjs/core/lib/es/index.js',
      },
      { find: /^rxjs$/, replacement: donor + '/node_modules/rxjs/dist/esm5/index.js' },
    ],
  },
  build: {
    outDir: out + '/bundle',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    lib: {
      entry: here + '/entry.ts',
      name: 'SPN146NativeRuntime',
      formats: ['iife'],
      fileName: () => 'runtime.js',
    },
  },
  plugins: [
    {
      name: 'retain-runtime-inputs',
      generateBundle() {
        for (const id of this.getModuleIds()) modules.add(id);
      },
    },
  ],
});
const closure: any[] = [];
const packagePaths = new Set<string>();
for (const id of [...modules].sort()) {
  if (id.startsWith('\0')) {
    closure.push({ id, virtual: true });
    continue;
  }
  const file = id.split('?')[0];
  const path = await realpath(file);
  const bytes = await readFile(path);
  closure.push({ id, path, bytes: bytes.length, sha256: hash(bytes) });
  if (path.startsWith(donor + '/node_modules/')) {
    let directory = dirname(path),
      found = false;
    while (directory.startsWith(donor + '/node_modules/')) {
      try {
        const p = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
        const key = relative(donor, directory);
        if (lock.packages[key]) {
          assert.equal(p.version, lock.packages[key].version, key);
          packagePaths.add(key);
          found = true;
          break;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      directory = dirname(directory);
    }
    assert.equal(found, true, `Unbound dependency ${path}`);
  } else
    assert.equal(path, await realpath(here + '/entry.ts'), `Unexpected nonpackage input ${path}`);
}
const output = await readFile(out + '/bundle/runtime.js');
const receipt = {
  source,
  hostedSource: build.source,
  unitId: capture.unitId,
  lockSha256: hash(lockBytes),
  fixtureSha256: hash(test),
  builderSha256: hash(await readFile(new URL('./build.ts', import.meta.url))),
  entrySha256: hash(entry),
  bodySha256: hash(body),
  bundleSha256: hash(output),
  bundleBytes: output.length,
  nativeHashes,
  inputSha256: hash(JSON.stringify(pairs)),
  toolVersions,
  packages: [...packagePaths].sort(),
  modules: closure,
};
await writeFile(out + '/preparation.json', JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify({
    source,
    bundleBytes: output.length,
    packages: receipt.packages,
    modules: closure.length,
  }),
);
