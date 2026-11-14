/** Run hosted process fixtures with production-like PID visibility, retaining
 * the host network namespace for loopback and abstract Unix ownership leases.
 * No test command, argument or environment value is changed or logged here.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';

interface Invocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  uid: number;
  gid: number;
  pidNamespace: string;
  mountNamespace: string;
  networkNamespace: string;
}
const namespace = (name: string) => readlinkSync(`/proc/self/ns/${name}`);
const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;
const signalCode = (signal: NodeJS.Signals | null) =>
  signal ? 128 + constants.signals[signal] : 1;

if (process.argv[2] === '--inside') {
  assert.equal(process.ppid, 1, 'The fixture wrapper must be owned by namespace init.');
  assert.equal(readFileSync('/proc/1/comm', 'utf8').trim(), 'tini');
  // stdin carries the original environment privately through sudo/setpriv. It
  // never enters command arguments, files, diagnostic output or a root shell.
  const input = await new Promise<string>((resolveInput) => {
    let buffer = '',
      received = false;
    process.stdin.setEncoding('utf8');
    // Keep this pipe open after its first line. Even SIGKILL of the outer owner
    // closes the writer. This wrapper exits, Tini follows, and the kernel kills
    // every remaining namespace descendant.
    process.stdin.once('end', () => process.exit(1));
    process.stdin.once('error', () => process.exit(1));
    process.stdin.on('data', (chunk: string) => {
      if (received) process.exit(1);
      buffer += chunk;
      assert.ok(buffer.length <= 1024 * 1024, 'Fixture invocation exceeds its input budget.');
      const end = buffer.indexOf('\n');
      if (end < 0) return;
      assert.equal(end, buffer.length - 1, 'Unexpected fixture invocation data.');
      received = true;
      resolveInput(buffer.slice(0, end));
    });
  });
  const invocation = JSON.parse(input) as Invocation;
  assert.ok(invocation.uid > 0 && invocation.gid > 0);
  assert.equal(process.getuid!(), invocation.uid);
  assert.equal(process.geteuid!(), invocation.uid);
  assert.equal(process.getgid!(), invocation.gid);
  assert.equal(process.getegid!(), invocation.gid);
  assert.notEqual(namespace('pid'), invocation.pidNamespace);
  assert.notEqual(namespace('mnt'), invocation.mountNamespace);
  assert.equal(namespace('net'), invocation.networkNamespace);
  const status = readFileSync('/proc/self/status', 'utf8');
  for (const [field, expected] of [
    ['Uid', invocation.uid],
    ['Gid', invocation.gid],
  ] as const) {
    const ids = status
      .split('\n')
      .find((line) => line.startsWith(`${field}:`))
      ?.trim()
      .split(/\s+/)
      .slice(1)
      .map(Number);
    assert.deepEqual(ids, [expected, expected, expected, expected]);
  }
  for (const field of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb'])
    assert.match(status, new RegExp(`^${field}:\\s+0+$`, 'm'));
  assert.match(status, /^NoNewPrivs:\s+1$/m);
  // Tini reaps adopted orphans while this wrapper runs. It exits with this
  // wrapper, so namespace teardown also covers detached/orphan worker groups.
  for (const signal of signals) process.on(signal, () => process.exit(signalCode(signal)));
  const command = spawn(invocation.command, invocation.args, {
    env: invocation.env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  command.once('error', () => {
    console.error('The fixture command could not start.');
    process.exit(127);
  });
  command.once('exit', (code, signal) => process.exit(code ?? signalCode(signal)));
} else {
  assert.equal(process.platform, 'linux', 'The hosted PID fixture requires Linux.');
  const uid = process.getuid!(),
    gid = process.getgid!();
  assert.ok(uid > 0 && gid > 0, 'Run the fixture wrapper as the nonroot CI runner.');
  const [command, ...args] = process.argv.slice(2);
  assert.ok(command, 'Usage: node scripts/ci/pid-namespace.ts COMMAND [ARGUMENTS...]');
  const groups = process.getgroups!();
  const invocation: Invocation = {
    command,
    args,
    env: process.env,
    uid,
    gid,
    pidNamespace: namespace('pid'),
    mountNamespace: namespace('mnt'),
    networkNamespace: namespace('net'),
  };
  const child = spawn(
    '/usr/bin/sudo',
    [
      '-n',
      '--',
      '/usr/bin/unshare',
      '--mount',
      '--pid',
      '--fork',
      '--mount-proc',
      '--propagation=private',
      '--kill-child',
      '--',
      '/usr/bin/setpriv',
      `--reuid=${uid}`,
      `--regid=${gid}`,
      ...(groups.length ? [`--groups=${groups.join(',')}`] : ['--clear-groups']),
      '--bounding-set=-all',
      '--inh-caps=-all',
      '--ambient-caps=-all',
      '--no-new-privs',
      '--',
      '/usr/bin/tini',
      '--',
      process.execPath,
      fileURLToPath(import.meta.url),
      '--inside',
    ],
    {
      // Only fixed system utilities run before the UID/GID/capability drop.
      env: {
        PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
        ...(process.env.RUNNER_TRACKING_ID && {
          RUNNER_TRACKING_ID: process.env.RUNNER_TRACKING_ID,
        }),
      },
      stdio: ['pipe', 'inherit', 'inherit'],
      detached: true,
    },
  );
  let finished = false;
  let stopping: NodeJS.Signals | undefined;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const identity = (() => {
    try {
      return child.pid
        ? readFileSync(`/proc/${child.pid}/stat`, 'utf8')
            .replace(/^.*\) /, '')
            .split(' ')[19]
        : undefined;
    } catch {
      return undefined;
    }
  })();
  const kill = (signal: NodeJS.Signals) => {
    if (finished || !child.pid || !identity) return;
    try {
      const current = readFileSync(`/proc/${child.pid}/stat`, 'utf8')
        .replace(/^.*\) /, '')
        .split(' ');
      if (current[19] !== identity || Number(current[2]) !== child.pid) return;
    } catch {
      return;
    }
    // The detached sudo/unshare group is unique to this invocation. Sudo is
    // noninteractive with piped stdin; no terminal/PTY changes its session.
    // Privilege is needed only to signal its still-root namespace launcher.
    spawnSync(
      '/usr/bin/sudo',
      ['-n', '--', '/usr/bin/kill', '--signal', signal, '--', `-${child.pid}`],
      {
        stdio: 'ignore',
        timeout: 5_000,
      },
    );
  };
  for (const signal of signals)
    process.on(signal, () => {
      if (stopping) return;
      stopping = signal;
      child.stdin.destroy();
      kill(signal);
      killTimer = setTimeout(() => kill('SIGKILL'), 5_000);
    });
  child.stdin.on('error', () => {});
  child.stdin.write(JSON.stringify(invocation) + '\n');
  child.once('error', () => {
    finished = true;
    child.stdin.destroy();
    clearTimeout(killTimer);
    console.error('The privileged namespace launcher could not start.');
    process.exitCode = 127;
  });
  child.once('exit', (code, signal) => {
    finished = true;
    child.stdin.destroy();
    clearTimeout(killTimer);
    process.exitCode = stopping ? signalCode(stopping) : (code ?? signalCode(signal));
  });
}
