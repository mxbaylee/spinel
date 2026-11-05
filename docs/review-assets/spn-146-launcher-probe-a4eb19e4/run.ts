import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, symlink, realpath, rename } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { ownedProcesses, processes, signalOwned } from '/tmp/spn135-local-processes.ts';
import type { ProcessRow } from '/tmp/spn135-local-processes.ts';

const root = '/tmp/spn146-launcher-probe/run';
// A previous partial or completed observation cannot be overwritten or repeated.
await mkdir(root);
const record: any = { complete: false, phase: 'preflight', source: 'a4eb19e4c5b95ba589042fe181cbcec2aa848990', order: ['npm', 'direct'], criterion: 'Same selected real CLI/test/worker/result/cleanup, wrapper ancestors removed, >=65536KiB lower concurrently owned RSS at first ready barrier', samples: [], secondaryErrors: [] };
const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
async function persist() {
  await writeFile(root + '/result.json.tmp', JSON.stringify(record, null, 2) + '\n');
  await rename(root + '/result.json.tmp', root + '/result.json');
}
await persist();
let failure: unknown;
try {
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), record.source);
  assert.equal(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
  const donor = '/Users/mxbaylee/projects/spinel/node_modules';
  const require = createRequire(donor + '/@playwright/test/package.json');
  const packagePath = require.resolve('@playwright/test/package.json');
  const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
  assert.equal(pkg.version, '1.64.1');
  assert.equal(pkg.bin.playwright, 'cli.js');
  const cli = await realpath(join(dirname(packagePath), 'cli.js'));
  const program = await realpath(require.resolve('playwright/lib/program'));
  const npm = join(dirname(process.execPath), '../lib/node_modules/npm/bin/npx-cli.js');
  record.identities = { node: process.version, executable: process.execPath, npm: JSON.parse(await readFile(join(dirname(npm), '../package.json'), 'utf8')).version, npmEntry: await realpath(npm), npmEntrySha256: hash(await readFile(npm)), package: pkg.version, cli, cliSha256: hash(await readFile(cli)), program, programSha256: hash(await readFile(program)), helperSha256: hash(await readFile('/tmp/spn135-local-processes.ts')), runnerSha256: hash(await readFile(import.meta.filename)) };
  const fixture = root + '/fixture';
  await mkdir(fixture + '/node_modules/.bin', { recursive: true });
  await symlink(cli, fixture + '/node_modules/.bin/playwright');
  await writeFile(fixture + '/package.json', JSON.stringify({ name: 'spn146-launcher-capability', private: true, version: '0.0.0' }));
  await writeFile(fixture + '/playwright.config.ts', "export default { testDir: '.', testMatch: 'barrier.spec.ts', timeout: 6000, workers: 1, retries: 0, reporter: 'json', outputDir: './results', metadata: {} };\n");
  await writeFile(fixture + '/barrier.spec.ts', `
import { test } from ${JSON.stringify(require.resolve('@playwright/test'))};
import { createRequire } from 'node:module';
import { writeFileSync, renameSync, existsSync, realpathSync } from 'node:fs';
const require = createRequire(${JSON.stringify(packagePath)});
test.afterEach(async ({}, info) => {
  writeFileSync('settled.json', JSON.stringify({ title: info.title, status: info.status, retry: info.retry, workerIndex: info.workerIndex }));
});
test('same launcher barrier', async ({}, info) => {
  writeFileSync('ready.json.tmp', JSON.stringify({ pid: process.pid, parent: process.ppid, node: process.version, execPath: process.execPath, title: info.title, retry: info.retry, workerIndex: info.workerIndex, program: realpathSync(require.resolve('playwright/lib/program')), modules: Object.keys(require.cache).filter(p => p.includes('/node_modules/')).sort(), npmEnvironmentKeys: Object.keys(process.env).filter(k => /^(npm_|INIT_CWD|PATH$)/.test(k)).sort(), nodeOptions: process.env.NODE_OPTIONS ?? null }));
  renameSync('ready.json.tmp', 'ready.json');
  while (!existsSync('release')) await new Promise(resolve => setTimeout(resolve, 10));
});
`);
  const fixtureHashes = Object.fromEntries(await Promise.all(['package.json', 'playwright.config.ts', 'barrier.spec.ts'].map(async path => [path, hash(await readFile(fixture + '/' + path))])));
  record.fixtureHashes = fixtureHashes;
  record.phase = 'comparison';
  await persist();
  const args = ['test', '--config', fixture + '/playwright.config.ts', '--retries=0'];
  const environment = { ...process.env, NODE_PATH: donor, FORCE_COLOR: '0', npm_config_offline: 'true', npm_config_yes: 'false', npm_config_audit: 'false', npm_config_fund: 'false', PATH: fixture + '/node_modules/.bin:' + process.env.PATH };
  for (const mode of record.order) {
    const directory = root + '/' + mode;
    await mkdir(directory);
    // Same cwd/fixture/args. The completed old handshake is moved, never discarded.
    if (mode === 'direct') for (const name of ['ready.json', 'settled.json', 'release']) await rename(fixture + '/' + name, root + '/npm/' + name);
    assert.equal(await realpath(fixture + '/node_modules/.bin/playwright'), cli);
    for (const [path, expected] of Object.entries(fixtureHashes)) assert.equal(hash(await readFile(fixture + '/' + path)), expected);
    const sample: any = { mode, complete: false, phase: 'launch', peakKiB: 0, ready: null, barrier: null, cleanup: false };
    record.samples.push(sample);
    await persist();
    const known = new Map<number, ProcessRow>();
    const started = performance.now();
    const commandArgs = mode === 'npm' ? [npm, '--offline', '--yes=false', 'playwright', ...args] : [cli, ...args];
    sample.command = { executable: process.execPath, args: commandArgs };
    const child = spawn(process.execPath, commandArgs, { cwd: fixture, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', exited = false, childError: unknown;
    const exit = new Promise<{ code: number | null; signal: string | null }>(resolve => {
      child.on('error', error => { childError = error; });
      child.on('close', (code, signal) => { exited = true; resolve({ code, signal }); });
    });
    let stdoutBytes = 0, stderrBytes = 0;
    child.stdout!.on('data', (data: Buffer) => { const retained = data.subarray(0, Math.max(0, 1024 * 1024 - stdoutBytes)); stdout += retained.toString(); stdoutBytes += retained.length; if (retained.length !== data.length) childError ??= new Error('stdout exceeds1MiB'); });
    child.stderr!.on('data', (data: Buffer) => { const retained = data.subarray(0, Math.max(0, 1024 * 1024 - stderrBytes)); stderr += retained.toString(); stderrBytes += retained.length; if (retained.length !== data.length) childError ??= new Error('stderr exceeds1MiB'); });
    const snapshot = () => {
      const live = ownedProcesses(processes(), process.pid, known);
      const rssKiB = live.reduce((sum, row) => sum + row.rssKiB, 0);
      sample.peakKiB = Math.max(sample.peakKiB, rssKiB);
      const state = { elapsedMs: performance.now() - started, rssKiB, live };
      if (!Number.isFinite(rssKiB) || !Number.isFinite(state.elapsedMs) || state.elapsedMs >= 15000 || rssKiB > 2 * 1024 ** 2) {
        sample.firstViolation ??= state;
        failure ??= new Error('Launcher15second/2GiB resource bound');
      }
      return state;
    };
    try {
      while (true) {
        const state = snapshot();
        sample.last = state;
        if (failure) throw failure;
        if (childError) throw childError;
        assert.ok(state.elapsedMs < 15000, 'Launcher15second bound');
        assert.ok(state.rssKiB <= 2 * 1024 ** 2, 'Launcher2GiB bound');
        if (!sample.barrier) {
          try {
            sample.ready = JSON.parse(await readFile(fixture + '/ready.json', 'utf8'));
            sample.barrier = snapshot(); // Exactly first observed barrier, no preferred-RSS wait.
            if (failure) throw failure;
            sample.phase = 'barrier';
            await persist();
            await writeFile(fixture + '/release', 'one sample\n', { flag: 'wx' });
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        if (exited) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      sample.exit = await exit;
      assert.equal(sample.exit.code, 0, stderr);
      assert.equal(sample.exit.signal, null);
      assert.ok(sample.barrier);
      sample.settled = JSON.parse(await readFile(fixture + '/settled.json', 'utf8'));
      assert.deepEqual(sample.settled, { title: 'same launcher barrier', status: 'passed', retry: 0, workerIndex: 0 });
      assert.equal(sample.ready.program, program);
      assert.equal(sample.ready.node, process.version);
      const report = JSON.parse(stdout);
      assert.equal(report.stats.expected, 1); assert.equal(report.stats.unexpected, 0); assert.equal(report.stats.skipped, 0); assert.equal(report.stats.flaky, 0);
      sample.reportStats = report.stats;
      sample.phase = 'settled';
    } catch (error) { failure ??= error; sample.failure = String(error); }
    finally {
      try {
        snapshot();
        if (failure) {
          try { signalOwned(known, 'SIGKILL', process.pid); }
          catch (error) { record.secondaryErrors.push(String(error)); }
        }
        if (!exited) await exit;
        sample.final = snapshot();
        const settled = () => sample.final.live.every((row: ProcessRow) => row.pid === process.pid || row.parent === process.pid && /^(?:\/bin\/)?ps -axo /.test(row.command));
        sample.cleanup = settled();
        if (!sample.cleanup) {
          sample.firstUnsettled = sample.final;
          failure ??= new Error('Launcher descendants remain'); sample.failure ??= String(failure);
          signalOwned(known, 'SIGKILL', process.pid);
          const reapUntil = performance.now() + 1000;
          do { await new Promise(resolve => setTimeout(resolve, 10)); sample.final = snapshot(); } while (!settled() && performance.now() < reapUntil);
          sample.cleanup = settled();
        }
        await writeFile(directory + '/stdout.json', stdout);
        await writeFile(directory + '/stderr.log', stderr);
        sample.complete = !failure;
        await persist();
      } catch (error) { if (failure) record.secondaryErrors.push(String(error)); else failure = error; }
    }
    if (failure) throw failure;
  }
  for (const name of ['ready.json', 'settled.json', 'release']) await rename(fixture + '/' + name, root + '/direct/' + name);
  const [old, direct] = record.samples;
  const ancestors = (sample: any) => {
    const result: ProcessRow[] = [];
    let pid = sample.ready.pid;
    while (pid !== process.pid) { const row = sample.barrier.live.find((row: ProcessRow) => row.pid === pid); assert.ok(row, 'Missing worker ancestor'); result.push(row); pid = row.parent; }
    return result;
  };
  old.ancestors = ancestors(old); direct.ancestors = ancestors(direct);
  assert.ok(old.ancestors.some((row: ProcessRow) => /npm exec/.test(row.command)), 'Old path must retain npm executor');
  assert.ok(!direct.ancestors.some((row: ProcessRow) => /npm exec|npx-cli/.test(row.command)), 'Direct path must remove npm executor');
  assert.ok(direct.ancestors.length < old.ancestors.length, 'Wrapper topology must shrink');
  for (const field of ['node', 'execPath', 'title', 'retry', 'workerIndex', 'program', 'nodeOptions', 'modules']) assert.deepEqual(old.ready[field], direct.ready[field]);
  record.dependencyClosure = await Promise.all(old.ready.modules.map(async (path: string) => ({ path: await realpath(path), sha256: hash(await readFile(path)) })));
  assert.equal(hash(await readFile(cli)), record.identities.cliSha256);
  assert.equal(hash(await readFile(program)), record.identities.programSha256);
  record.reductionKiB = old.barrier.rssKiB - direct.barrier.rssKiB;
  assert.ok(record.reductionKiB >= 65536, 'Fixed64MiB simultaneous-owned reduction not met');
  record.complete = true;
  record.phase = 'settled';
} catch (error) { failure ??= error; record.failure = String(failure); record.phase = 'failed'; }
finally {
  try { await persist(); } catch (error) { if (failure) console.error('Secondary persistence failure', error); else failure = error; }
}
if (failure) throw failure;
console.log(JSON.stringify({ complete: record.complete, reductionKiB: record.reductionKiB, samples: record.samples.map((s: any) => ({ mode: s.mode, barrierKiB: s.barrier.rssKiB, peakKiB: s.peakKiB })) }));
