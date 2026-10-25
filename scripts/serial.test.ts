import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

const limit = 6000;
const expired = limit + 60_000;
const options = { skip: process.platform === 'win32', timeout: 20_000 };
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type Running = {
  kind: 'runner' | 'dummy';
  child: ChildProcess;
  done: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  output: () => string;
};

async function until(check: () => boolean, description: string) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    assert.ok(Date.now() < deadline, `timed out: ${description}`);
    await wait(10);
  }
}

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'spinel-serial-'));
  const lock = join(dir, 'lock');
  const serial = join(dir, 'serial.ts');
  const dummy = join(dir, 'dummy.ts');
  const preload = join(dir, 'preload.ts');
  // CI can point this at a deliberately broken scratch copy to prove that
  // the regressions fail. Every copy must still have its lock isolated here.
  let source = readFileSync(
    process.env.SPINEL_SERIAL_TEST_SOURCE ?? new URL('./serial.ts', import.meta.url),
    'utf8',
  );
  for (const [from, to] of [
    ["const lock = '/tmp/spinel-test.lock';", `const lock = ${JSON.stringify(lock)};`],
    ['const limit = 8 * 60 * 1000;', `const limit = ${limit};`],
    ['await wait(2000);', 'await wait(20);'],
  ]) {
    assert.equal(source.split(from).length, 2, `expected one fixture substitution: ${from}`);
    source = source.replace(from, to);
  }
  assert.ok(!source.includes('/tmp/spinel-test.lock'), 'the shared lock must never be used');
  writeFileSync(serial, source);
  writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
  writeFileSync(
    dummy,
    `import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
const [mode, path, value] = process.argv.slice(2);
if (mode === 'hold') {
  writeFileSync(path, 'ready');
  setInterval(() => {}, 1000);
} else if (mode === 'work') {
  try {
    mkdirSync(path);
  } catch {
    appendFileSync(value, 'overlap\\n');
    console.error('serial fixture: overlapping workloads');
    process.exit(42);
  }
  appendFileSync(value, 'start\\n');
  await new Promise((resolve) => setTimeout(resolve, 300));
  appendFileSync(value, 'end\\n');
  rmSync(path, { recursive: true });
} else if (mode === 'probe') {
  let state = 'alive';
  try {
    process.kill(-Number(value), 0);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
    state = 'gone';
  }
  writeFileSync(path, state);
} else if (mode === 'mark') {
  writeFileSync(path, 'ran');
}
`,
  );
  writeFileSync(
    preload,
    `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const config = JSON.parse(process.env.SPINEL_SERIAL_FIXTURE);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
if (config.gate) {
  fs.writeFileSync(config.gate + '-' + config.index, 'ready');
  while (!fs.existsSync(config.gate)) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
if (config.staleOwner) {
  const mkdir = fs.mkdirSync;
  const read = fs.readFileSync;
  const remove = fs.rmSync;
  let captured = false;
  const seen = config.gate + '-seen-';
  fs.mkdirSync = (path, ...args) => {
    try {
      return mkdir(path, ...args);
    } catch (error) {
      if (String(path) === config.lock + '.break') {
        fs.writeFileSync(seen + config.index, 'blocked');
      }
      throw error;
    }
  };
  fs.readFileSync = (path, ...args) => {
    const value = read(path, ...args);
    if (String(path) === config.lock + '/pid' && String(value) === config.staleOwner) {
      // Every contender must either read the stale owner or be refused by
      // the breaker. Removing the breaker gives all six a stale snapshot.
      captured = true;
      fs.writeFileSync(seen + config.index, 'read');
      const deadline = Date.now() + 5000;
      while (!Array.from({ length: 6 }, (_, i) => fs.existsSync(seen + i)).every(Boolean)) {
        if (Date.now() > deadline) throw new Error('stale-reader barrier timed out');
        pause(10);
      }
    }
    return value;
  };
  fs.rmSync = (path, ...args) => {
    if (String(path) === config.lock && captured) {
      captured = false;
      pause(config.index * 20);
    }
    return remove(path, ...args);
  };
  syncBuiltinESMExports();
}
const kill = process.kill.bind(process);
let pending = false;
let delivered = false;
process.kill = (pid, signal) => {
  if (pid === -config.group) {
    fs.appendFileSync(config.signals, String(signal) + '\\n');
    if (config.deferKill) {
      if (signal === 'SIGKILL') {
        pending = true;
        return true;
      }
      if (signal === 0 && pending && !delivered) {
        // Deliver only on a later probe, so scheduling cannot conceal a
        // successor that starts before this fixture's group has exited.
        delivered = true;
        kill(pid, 'SIGKILL');
        return true;
      }
    }
  }
  return kill(pid, signal);
};
`,
  );

  const processes: Running[] = [];
  function start(
    kind: Running['kind'],
    args: string[],
    config: Record<string, unknown> = {},
  ): Running {
    const child = spawn(
      process.execPath,
      kind === 'runner' ? ['--import', preload, serial, ...args] : [dummy, ...args],
      {
        detached: kind === 'dummy',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, SPINEL_SERIAL_FIXTURE: JSON.stringify({ lock, ...config }) },
      },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve({ code, signal }));
      },
    );
    const running = { kind, child, done, output: () => output };
    processes.push(running);
    return running;
  }
  const exited = (run: Running) => run.child.exitCode !== null || run.child.signalCode !== null;
  t.after(async () => {
    // Stop runners before the dummies they may still be signalling. Cleanup
    // uses retained child handles, never arbitrary or already reaped groups.
    for (const kind of ['runner', 'dummy']) {
      const pending = processes.filter((run) => run.kind === kind && !exited(run));
      for (const run of pending) run.child.kill('SIGTERM');
      const force = setTimeout(() => {
        for (const run of pending) if (!exited(run)) run.child.kill('SIGKILL');
      }, 500);
      await Promise.allSettled(pending.map((run) => run.done));
      clearTimeout(force);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  async function finish(run: Running) {
    await until(() => exited(run), `child ${run.child.pid} to exit; ${run.output()}`);
    const result = await run.done;
    assert.equal(result.code, 0, run.output());
    assert.equal(result.signal, null, run.output());
  }
  async function deadOwner() {
    const run = start('dummy', ['exit']);
    await finish(run);
    assert.ok(run.child.pid);
    return run.child.pid;
  }
  async function liveGroup() {
    const ready = join(dir, 'ready');
    const run = start('dummy', ['hold', ready]);
    await until(() => existsSync(ready), 'dummy process group to be ready');
    assert.ok(run.child.pid);
    return { ...run, pid: run.child.pid };
  }
  function abandoned(runner: number, group?: number, age = 0) {
    mkdirSync(lock);
    writeFileSync(join(lock, 'pid'), `${runner}${group ? ` ${group}` : ''}`);
    const modified = new Date(Date.now() - age);
    utimesSync(lock, modified, modified);
  }
  return { dir, lock, dummy, start, finish, deadOwner, liveGroup, abandoned };
}

test(
  'six simultaneous waiters recover a dead owner without overlapping workloads',
  options,
  async (t) => {
    const f = fixture(t);
    const owner = await f.deadOwner();
    f.abandoned(owner);
    const gate = join(f.dir, 'go');
    const events = join(f.dir, 'events');
    const active = join(f.dir, 'active');
    const runs = Array.from({ length: 6 }, (_, index) =>
      f.start('runner', [process.execPath, f.dummy, 'work', active, events], {
        gate,
        index,
        staleOwner: `${owner}`,
      }),
    );
    await until(
      () => runs.every((_, index) => existsSync(`${gate}-${index}`)),
      'all six runners to reach the starting barrier',
    );
    writeFileSync(gate, 'go');
    await Promise.all(runs.map(f.finish));
    assert.deepEqual(
      readFileSync(events, 'utf8').trim().split('\n'),
      Array(6).fill(['start', 'end']).flat(),
    );
    assert.ok(!existsSync(f.lock));
    assert.ok(!existsSync(`${f.lock}.break`));
  },
);

test(
  'an expired lock never probes or signals its possibly reused live group',
  options,
  async (t) => {
    const f = fixture(t);
    const owner = await f.deadOwner();
    const group = await f.liveGroup();
    f.abandoned(owner, group.pid, expired + 1000);
    const signals = join(f.dir, 'signals');
    const ran = join(f.dir, 'ran');
    const run = f.start('runner', [process.execPath, f.dummy, 'mark', ran], {
      group: group.pid,
      signals,
    });
    await f.finish(run);
    assert.equal(readFileSync(ran, 'utf8'), 'ran');
    assert.ok(!existsSync(signals), 'expired identity must not be consulted or signalled');
    assert.equal(group.child.exitCode, null);
    assert.equal(group.child.signalCode, null);
    assert.ok(process.kill(group.pid, 0), 'the fixture group is still alive');
  },
);

test(
  'a dead runner past the limit retains its lock until the owned group exits',
  options,
  async (t) => {
    const f = fixture(t);
    const owner = await f.deadOwner();
    const group = await f.liveGroup();
    f.abandoned(owner, group.pid, limit + 100);
    const signals = join(f.dir, 'signals');
    const state = join(f.dir, 'state');
    const run = f.start('runner', [process.execPath, f.dummy, 'probe', state, `${group.pid}`], {
      group: group.pid,
      signals,
      deferKill: true,
    });
    await f.finish(run);
    assert.equal(readFileSync(state, 'utf8'), 'gone', 'the successor must start after group exit');
    assert.ok(readFileSync(signals, 'utf8').split('\n').includes('SIGKILL'));
    assert.deepEqual(await group.done, { code: null, signal: 'SIGKILL' });
    assert.ok(!existsSync(f.lock));
  },
);
