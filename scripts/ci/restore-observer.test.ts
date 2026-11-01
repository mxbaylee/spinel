/** Focused harness lifecycle regressions: node --test scripts/ci/restore-observer.test.ts */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RestoreObserver, containRestoreObserver } from '../../e2e/restore-observer.ts';
const image = `sha256:${'a'.repeat(64)}`;
const id = 'b'.repeat(64);
const options = {
  name: 'spinel-observer-test',
  volume: 'spinel-observer-test-state',
  image,
  user: '501:20',
};
function fixture() {
  const calls: string[][] = [];
  let running = true;
  let removed = false;
  let inventoryUnavailable = false;
  let stopUnavailable = false;
  const observer = new RestoreObserver(options, async (args) => {
    calls.push(args);
    let stdout = '';
    if (args[0] === 'run') stdout = id;
    else if (args[0] === 'inspect')
      stdout = JSON.stringify([
        {
          Id: id,
          Image: image,
          Config: {
            User: options.user,
            Entrypoint: ['/bin/sh'],
            Cmd: ['-c', 'trap "exit 0" TERM INT; sleep 600 & wait'],
          },
          HostConfig: {
            NetworkMode: 'none',
            PidMode: '',
            ReadonlyRootfs: true,
            Memory: 33554432,
            MemorySwap: 33554432,
            NanoCpus: 100000000,
            PidsLimit: 16,
          },
          Mounts: [{ Destination: '/state', Name: options.volume, RW: false }],
          State: {
            Running: running,
            Pid: running ? 123 : 0,
            ExitCode: 0,
            OOMKilled: false,
            Error: '/private/source.key material',
          },
        },
      ]);
    else if (args[0] === 'container') {
      if (inventoryUnavailable && !removed) throw new Error('inventory unavailable');
      stdout = removed ? '' : id;
    } else if (args[0] === 'exec') {
      if (args[2] === 'readlink') stdout = 'pid:[1234]';
      else stdout = args.at(-1) === '/sys/fs/cgroup/cpu.max' ? '10000 100000' : '1024';
    } else if (args[0] === 'logs')
      return { stdout: '/private/source.key EACCES', stderr: 'secret native context' };
    else if (args[0] === 'stop') {
      if (stopUnavailable) throw new Error('stop unavailable');
      running = false;
    } else if (args[0] === 'kill') running = false;
    else if (args[0] === 'rm') removed = true;
    return { stdout, stderr: '' };
  });
  return {
    observer,
    calls,
    failInventory: () => {
      inventoryUnavailable = true;
    },
    failStop: () => {
      stopUnavailable = true;
    },
  };
}
for (const failure of ['proof write rejected', 'serving cleanup rejected']) {
  test(`observer containment still runs when ${failure}`, async () => {
    const f = fixture();
    await f.observer.start();
    const result = await containRestoreObserver(
      async () => {
        throw new Error(failure);
      },
      () => f.observer.close(),
    );
    assert.deepEqual(result, { workCompleted: false, observerClosed: true });
    assert.ok(f.calls.some((args) => args[0] === 'stop' && args.at(-1) === id));
    assert.ok(f.calls.some((args) => args[0] === 'rm' && args[1] === id));
    assert.equal(f.observer.evidence.absenceConfirmed, true);
  });
}
test('unavailable inventory and rejected stop still force containment of the verified container ID', async () => {
  const f = fixture();
  await f.observer.start();
  f.failInventory();
  f.failStop();
  assert.equal(await f.observer.close(), true);
  assert.equal(f.observer.evidence.initialInventoryUnavailable, true);
  assert.ok(f.calls.some((args) => args[0] === 'kill' && args[1] === id));
  assert.ok(
    f.calls.findIndex((args) => args[0] === 'logs') < f.calls.findIndex((args) => args[0] === 'rm'),
  );
  assert.deepEqual(f.observer.evidence.closure, {
    running: false,
    pid: 0,
    exitCode: 0,
    oomKilled: false,
  });
});
test('published observer diagnostics exclude raw native logs and Docker state errors', async () => {
  const f = fixture();
  await f.observer.start();
  assert.equal(await f.observer.close(), true);
  const encoded = JSON.stringify(f.observer.evidence);
  assert.ok(!encoded.includes('/private'));
  assert.ok(!encoded.includes('secret native'));
  assert.deepEqual(f.observer.evidence.logs, {
    stdoutBytes: 26,
    stderrBytes: 21,
    errorCode: 'EACCES',
  });
});
test('observer cleanup rejection remains recorded and cannot replace an earlier failure', async () => {
  let called = 0;
  const result = await containRestoreObserver(
    async () => {
      throw new Error('write failed');
    },
    async () => {
      called++;
      throw new Error('closure unknown');
    },
  );
  assert.deepEqual(result, { workCompleted: false, observerClosed: false });
  assert.equal(called, 1);
});
