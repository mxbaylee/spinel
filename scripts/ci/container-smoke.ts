import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const version = readFileSync('.nvmrc', 'utf8').trim();
assert.match(version, /^\d+\.\d+\.\d+$/);
const directory = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'spinel-container-smoke-'));
const dataDirectory = join(directory, 'data');
const names = ['native', 'first', 'restart'].map((phase) => `${basename(directory)}-${phase}`);
const origin = 'http://localhost:3105';
const base = 'http://127.0.0.1:3105';
// Match the app's deployment limits without involving its proxy or tailnet.
const limits = [
  '--read-only',
  '--cap-drop=ALL',
  '--security-opt=no-new-privileges:true',
  '--tmpfs=/tmp:size=16m,mode=1777',
  '--memory=1024m',
  '--cpus=0.75',
  '--pids-limit=128',
];

function run(
  command: string,
  args: string[],
  options: { input?: string; timeout?: number; live?: boolean } = {},
) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout ?? 30_000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: options.live ? 'inherit' : ['pipe', 'pipe', 'inherit'],
  });
  assert.ok(!result.error, `${command} ${args[0]} could not complete.`);
  assert.equal(result.status, 0, `${command} ${args[0]} failed.`);
  return result.stdout ?? '';
}

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  spawnSync('docker', ['rm', '--force', ...names], { stdio: 'ignore', timeout: 30_000 });
  // The container's UID 1000 owns the database and WAL; the runner may have a
  // different UID. Remove only this run's freshly created temporary directory.
  const result = spawnSync('sudo', ['-n', 'rm', '-rf', '--', directory], {
    stdio: 'inherit',
    timeout: 30_000,
  });
  if (result.error || result.status !== 0) {
    console.error('Could not remove the container smoke directory.');
    process.exitCode = 1;
  }
}
process.once('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.once('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

function request(path: string) {
  return fetch(`${base}${path}`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000),
  });
}

async function checkServer() {
  const deadline = Date.now() + 60_000;
  let response: Response | undefined;
  while (Date.now() < deadline) {
    try {
      const candidate = await request('/sign-in');
      if (candidate.status === 200) {
        response = candidate;
        break;
      }
      await candidate.body?.cancel();
    } catch {
      // Startup includes opening both databases and reading the built HTML.
    }
    await delay(500);
  }
  assert.ok(response, 'The production container did not become ready within 60 seconds.');
  assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/);
  const html = await response.text();
  assert.match(html, /<div\b[^>]*\bid=["']root["']/);
  const script = /<script\b[^>]*\bsrc=["'](\/assets\/[^"']+\.js)["']/.exec(html);
  assert.ok(script, 'The sign-in HTML has no built JavaScript entry.');
  const asset = await request(script[1]);
  // Missing assets redirect to sign-in; following that redirect would hide a
  // broken final image behind a successful HTML response.
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type') ?? '', /^(?:text|application)\/javascript\b/);
  assert.ok((await asset.arrayBuffer()).byteLength > 0, 'The built JavaScript asset is empty.');
  const health = await request('/api/health');
  assert.equal(health.status, 401);
  assert.deepEqual(await health.json(), {
    error: 'Sign in to continue.',
    redirect: '/sign-in',
  });
}

function issueSetup(name: string) {
  // The successful output contains a private key. Keep it out of command-error
  // objects, inherited streams, assertion values, and later failure diagnostics.
  const result = spawnSync('docker', ['exec', name, 'node', 'server/setup.ts'], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 15_000,
    maxBuffer: 64 * 1024,
  });
  assert.ok(!result.error && result.status === 0, 'The private setup command failed.');
  const line = (result.stdout ?? '').trimEnd().split(/\r?\n/).at(-1) ?? '';
  const prefix = `${origin}/setup#`;
  const fragment = line.startsWith(prefix) ? line.slice(prefix.length) : '';
  const match = /^([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/.exec(fragment);
  assert.ok(match, 'Setup did not return the expected one-time link.');
  return match[1];
}

const databaseProbe = String.raw`
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openDatabase } from './server/database.ts';
const database = openDatabase(process.env.DATABASE_PATH);
try {
  assert.deepEqual(database.prepare('PRAGMA integrity_check').all(), [{ integrity_check: 'ok' }]);
  const row = database.prepare(
    'SELECT id, hex(public_key) AS public_key, user_id, expires_at FROM auth_setup WHERE singleton=1'
  ).get();
  assert.ok(row, 'The setup record is missing.');
  assert.equal(row.id, process.env.EXPECTED_SETUP_ID);
  assert.ok(typeof row.public_key === 'string' && row.public_key.length > 0);
  assert.ok(typeof row.user_id === 'string' && row.user_id.length > 0);
  assert.ok(Number(row.expires_at) > Date.now());
  const fields = [row.id, row.public_key, row.user_id, String(row.expires_at)];
  console.log(createHash('sha256').update(JSON.stringify(fields)).digest('hex'));
} finally {
  database.close();
}
`;

function databaseHash(name: string, setupId: string) {
  const hash = run(
    'docker',
    ['exec', '-i', '--env', `EXPECTED_SETUP_ID=${setupId}`, name, 'node', '--input-type=module'],
    { input: databaseProbe, timeout: 15_000 },
  ).trim();
  assert.match(hash, /^[a-f0-9]{64}$/, 'The database probe did not return a record hash.');
  return hash;
}

function stop(name: string) {
  run('docker', ['stop', '--time', '30', name], { timeout: 40_000 });
  const state = JSON.parse(run('docker', ['inspect', '--format', '{{json .State}}', name]));
  assert.equal(state.Running, false);
  assert.equal(state.ExitCode, 0, 'The production container did not stop cleanly.');
  assert.equal(state.OOMKilled, false, 'The production container exceeded its memory limit.');
  run('docker', ['rm', name]);
}

async function checkPdfMemoryRefusal(name: string, requestPdf: () => Promise<Response>) {
  // Hold a bounded, touched allocation in this disposable container. It shares
  // the real cgroup with the app, proving admission accounts for other processes
  // before starting native work. Closing stdin releases only this helper.
  const pressure = spawn(
    'docker',
    [
      'exec',
      '-i',
      name,
      'node',
      '--input-type=module',
      '-e',
      String.raw`
import { readFileSync } from 'node:fs';
const allocations = [];
const limit = Number(readFileSync('/sys/fs/cgroup/memory.max', 'utf8'));
// Cross the actual 192 MiB worker + 32 MiB headroom admission threshold,
// retaining 208 MiB so the helper itself never approaches the cgroup ceiling.
const target = limit - (192 + 32 - 16) * 1024 * 1024;
for (let chunk = 0; chunk < 64; chunk++) {
  const current = Number(readFileSync('/sys/fs/cgroup/memory.current', 'utf8'));
  const stat = readFileSync('/sys/fs/cgroup/memory.stat', 'utf8');
  const inactive = Number(stat.match(/^inactive_file\s+(\d+)$/m)?.[1] ?? 0);
  const needed = target - Math.max(0, current - inactive);
  if (needed <= 0) break;
  allocations.push(Buffer.alloc(Math.min(8 * 1024 * 1024, needed), 0x5a));
}
globalThis.spinelPdfPressure = allocations;
process.stdin.on('end', () => process.exit(0));
process.stdin.resume();
setTimeout(() => process.exit(1), 20_000);
console.log('ready');
`,
    ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  );
  const completion = new Promise<number | null>((resolve, reject) => {
    pressure.once('error', reject);
    pressure.once('close', resolve);
  });
  // Attach the rejection immediately even if startup fails before the ready wait.
  void completion.catch(() => {});
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('PDF memory fixture was not ready.')),
        10_000,
      );
      pressure.stdout.once('data', (chunk: Buffer) => {
        clearTimeout(timer);
        if (chunk.toString().trim() === 'ready') resolve();
        else reject(new Error('PDF memory fixture did not report readiness.'));
      });
      completion.then(() => {
        clearTimeout(timer);
        reject(new Error('PDF memory fixture exited before its check.'));
      }, reject);
    });
    const response = await requestPdf();
    assert.equal(response.status, 413, 'PDF admission ignored the real container memory pressure.');
    assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
    assert.equal(response.headers.has('content-disposition'), false);
    assert.equal(typeof (await response.json()).error, 'string');
    await checkServer();
  } finally {
    pressure.stdin.end();
    assert.equal(await completion, 0, 'PDF memory fixture did not release its allocation.');
  }
  const recovery = await requestPdf();
  assert.equal(recovery.status, 200, 'PDF capacity did not recover after releasing memory.');
  assert.match(recovery.headers.get('content-type') ?? '', /^application\/pdf\b/);
  assert.ok((await recovery.arrayBuffer()).byteLength > 0);
}

async function checkPdfExports(name: string) {
  // Seed a synthetic everyday account through the existing stores. Its private
  // cookie stays inside this process and never enters logs or assertion output.
  const seed = JSON.parse(
    run('docker', ['exec', '-i', name, 'node', '--input-type=module'], {
      input: String.raw`
import { randomUUID } from 'node:crypto';
import { openDatabase } from './server/database.ts';
import { AuthStore } from './src/server/auth/store.ts';
import { WorkspaceStore } from './src/server/workspace/store.ts';
import { DocumentStore } from './src/server/workspace/documents.ts';
import { SheetStore } from './src/server/workspace/sheets.ts';
const db = openDatabase(process.env.DATABASE_PATH);
try {
  const auth = new AuthStore(db), workspace = new WorkspaceStore(auth);
  const owner = auth.createUser('Synthetic PDF owner');
  const doc = workspace.create(owner.id, {name:'PDF document',kind:'doc',parentId:null});
  const sheet = workspace.create(owner.id, {name:'PDF sheet',kind:'sheet',parentId:null});
  const lines = Array.from({length:35},(_,i)=>'Container paragraph '+(i+1)+'.');
  let at = 0;
  new DocumentStore(workspace).save(owner.id,doc.id,{revision:0,writeId:randomUUID(),snapshot:{
    id:doc.id,documentStyle:{pageSize:{width:450,height:280},marginTop:32,marginBottom:32,marginLeft:32,marginRight:32},
    body:{dataStream:lines.join('\r')+'\r\n',paragraphs:lines.map((line,i)=>{at+=line.length;return {startIndex:at++,paragraphId:'p'+i};})}
  }});
  new SheetStore(workspace).save(owner.id,sheet.id,{revision:0,writeId:randomUUID(),snapshot:{
    id:sheet.id,name:'PDF sheet',appVersion:'1.1.0',locale:'enUS',styles:{},sheetOrder:['one'],
    // Keep the label fully visible beside the formula; native cell clipping is
    // deliberately refused by the renderer and covered separately in lib tests.
    sheets:{one:{id:'one',name:'One',rowCount:100,columnCount:4,defaultColumnWidth:180,cellData:{0:{0:{v:'Container sheet'},1:{f:'=20+22',v:-1}}}}}
  }});
  const session=auth.createSession(owner.id);
  console.log(JSON.stringify({token:session.token,doc:doc.id,sheet:sheet.id}));
} finally { db.close(); }
`,
      timeout: 20_000,
    }),
  );
  assert.ok(
    typeof seed.token === 'string' &&
      typeof seed.doc === 'string' &&
      typeof seed.sheet === 'string',
    'PDF fixture setup failed.',
  );
  const { COOKIE_NAME } = await import('../../src/server/auth/store.ts');
  const requestPdf = (id: string) =>
    fetch(`${base}/api/items/${id}/pdf`, {
      method: 'POST',
      headers: {
        Cookie: `${COOKIE_NAME}=${seed.token}`,
        Origin: origin,
        'Content-Type': 'application/json',
      },
      body: '{}',
      signal: AbortSignal.timeout(60_000),
    });
  for (const [id, expected] of [
    [seed.doc, 'Container paragraph 35.'],
    [seed.sheet, '42'],
  ]) {
    const response = await requestPdf(id);
    assert.equal(
      response.status,
      200,
      'Production PDF export did not succeed within the 1 GiB app limit.',
    );
    assert.match(response.headers.get('content-type') ?? '', /^application\/pdf\b/);
    const task = getDocument({
      data: new Uint8Array(await response.arrayBuffer()),
      useSystemFonts: false,
    });
    try {
      const pdf = await task.promise;
      let text = '';
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      }
      assert.ok(text.includes(expected), 'The production PDF omitted confirmed content.');
      assert.ok(
        !JSON.stringify(await pdf.getMetadata()).includes('Synthetic PDF owner'),
        'PDF metadata exposed an account.',
      );
    } finally {
      await task.destroy();
    }
  }
  await checkPdfMemoryRefusal(name, () => requestPdf(seed.doc));
  const peak = run('docker', ['exec', name, 'cat', '/sys/fs/cgroup/memory.peak']).trim();
  console.log(
    `Production PDFs, memory refusal and recovery passed; container peak ${(Number(peak) / 1024 / 1024).toFixed(1)} MiB.`,
  );
  await checkServer();
}

try {
  console.log('Building the final production image.');
  const imageFile = join(directory, 'image-id');
  run('docker', ['build', '--pull', '--progress=plain', '--iidfile', imageFile, '.'], {
    live: true,
    timeout: 12 * 60_000,
  });
  const image = readFileSync(imageFile, 'utf8').trim();
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  const config = JSON.parse(
    run('docker', ['image', 'inspect', '--format', '{{json .Config}}', image]),
  );
  assert.equal(config.User, 'node');
  assert.deepEqual(config.Cmd, [
    'node',
    '--max-old-space-size=256',
    '--max-semi-space-size=8',
    'server/index.ts',
  ]);

  const native = run(
    'docker',
    [
      'run',
      '--rm',
      '-i',
      '--name',
      names[0],
      ...limits,
      '--network=none',
      '--env',
      `EXPECTED_NODE=v${version}`,
      image,
      'node',
      '--input-type=module',
    ],
    {
      timeout: 60_000,
      input: String.raw`
import assert from 'node:assert/strict';
import { createCanvas, PDFDocument } from '@napi-rs/canvas';
import sharp from 'sharp';
import { renderSheetPdf } from '@spinel/print';
assert.equal(process.version, process.env.EXPECTED_NODE);
assert.equal(process.getuid(), 1000);
assert.equal(process.getgid(), 1000);
assert.equal(typeof renderSheetPdf, 'function');
const canvas = createCanvas(2, 2);
const context = canvas.getContext('2d');
context.fillStyle = '#ff0000';
context.fillRect(0, 0, 2, 2);
const png = await canvas.encode('png');
const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
assert.deepEqual([info.width, info.height, info.channels], [2, 2, 4]);
assert.deepEqual([...data], Array.from({ length: 4 }, () => [255, 0, 0, 255]).flat());
const pdf = new PDFDocument({ creator: 'Spinel container smoke' });
const page = pdf.beginPage(20, 20);
page.fillStyle = '#ff0000';
page.fillRect(0, 0, 20, 20);
pdf.endPage();
const bytes = pdf.close();
assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-');
assert.match(bytes.subarray(-32).toString('ascii'), /%%EOF\s*$/);
console.log('Spinel native bindings OK');
`,
    },
  );
  assert.equal(native.trim(), 'Spinel native bindings OK');
  console.log('The image runs the pinned Node version and native Canvas, Sharp, and PDF bindings.');

  run('sudo', ['-n', 'install', '-d', '-m', '0700', '-o', '1000', '-g', '1000', dataDirectory]);
  let setupId = '';
  let firstHash = '';
  for (const name of names.slice(1)) {
    run('docker', [
      'run',
      '--detach',
      '--name',
      name,
      ...limits,
      '--network=host',
      '--env=HOST=127.0.0.1',
      '--env=PORT=3105',
      '--env=DATABASE_PATH=/data/spinel.sqlite',
      `--env=APP_ORIGIN=${origin}`,
      '--mount',
      `type=bind,source=${dataDirectory},target=/data`,
      image,
    ]);
    await checkServer();
    if (!setupId) {
      setupId = issueSetup(name);
      await checkPdfExports(name);
    }
    const hash = databaseHash(name, setupId);
    if (firstHash)
      assert.equal(hash, firstHash, 'The setup record did not survive container recreation.');
    else firstHash = hash;
    stop(name);
  }
  console.log(
    'Production assets, authentication, and SQLite persistence passed across recreation.',
  );
} catch (error) {
  // docker exec's captured setup output is separate from the app's PID 1 logs.
  for (const name of names.slice(1)) {
    const state = spawnSync('docker', ['inspect', '--format', '{{json .State}}', name], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (state.status !== 0) continue;
    console.error(`Container state: ${state.stdout.trim()}`);
    spawnSync('docker', ['logs', '--tail', '80', name], { stdio: 'inherit', timeout: 10_000 });
  }
  throw error;
} finally {
  cleanup();
}
