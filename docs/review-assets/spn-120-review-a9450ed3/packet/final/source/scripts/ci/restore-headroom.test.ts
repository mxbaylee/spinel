import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkVerificationHeadroom,
  RECOVERY_HEADROOM_PREFIX,
} from '../../src/server/backup/recovery-worker.ts';
import { RecoveryResourceError } from '../../src/server/backup/resource-error.ts';
import { restoreHeadroomDiagnostics } from '../../e2e/restore-headroom.ts';

const MiB = 1024 ** 2;
function fixture(usedMiB: number, availableMiB = 8192, stat = '') {
  const values: Record<string, string> = {
    '/sys/fs/cgroup/memory.max': String(1024 * MiB),
    '/sys/fs/cgroup/memory.current': String(usedMiB * MiB),
    '/proc/meminfo': `MemAvailable: ${availableMiB * 1024} kB\n`,
    '/sys/fs/cgroup/memory.stat': stat,
  };
  const lines: string[] = [];
  return {
    values,
    lines,
    read: async (path: string) => {
      if (!Object.hasOwn(values, path)) throw new Error('private unavailable path');
      return values[path];
    },
    report: (line: string) => lines.push(line),
  };
}

for (const [phase, admitted, hostMinimum] of [
  ['start', 384, 768],
  ['running', 896, 256],
] as const) {
  test(`${phase} preserves exact cgroup and host limits and records which branch refused`, async () => {
    const f = fixture(admitted, hostMinimum);
    await checkVerificationHeadroom(phase, f.read, 'linux', f.report);
    assert.deepEqual(f.lines, []);
    f.values['/sys/fs/cgroup/memory.current'] = String(admitted * MiB + 1);
    await assert.rejects(
      checkVerificationHeadroom(phase, f.read, 'linux', f.report),
      new RecoveryResourceError('memory-headroom'),
    );
    let records = restoreHeadroomDiagnostics(f.lines.join('\n'));
    assert.equal(records.malformed, 0);
    assert.equal(records.refusals[0].phase, phase);
    assert.equal(records.refusals[0].cgroupRefused, true);
    assert.equal(records.refusals[0].hostRefused, false);
    assert.equal(records.refusals[0].usedBytes, admitted * MiB + 1);
    assert.equal(records.refusals[0].cacheCountersValid, false);

    f.values['/sys/fs/cgroup/memory.current'] = String(admitted * MiB);
    f.values['/proc/meminfo'] = `MemAvailable: ${hostMinimum * 1024 - 1} kB\n`;
    await assert.rejects(checkVerificationHeadroom(phase, f.read, 'linux', f.report));
    records = restoreHeadroomDiagnostics(f.lines.join('\n'));
    assert.equal(records.refusals[1].cgroupRefused, false);
    assert.equal(records.refusals[1].hostRefused, true);
    assert.equal(records.refusals[1].availableKiB, hostMinimum * 1024 - 1);
  });
}

test('refusal records the actual conservative cache calculation without crediting active or dirty pages', async () => {
  const stat = `file ${400 * MiB}\nshmem ${20 * MiB}\ninactive_file ${300 * MiB}\nfile_dirty ${30 * MiB}\nfile_writeback ${10 * MiB}\n`;
  const f = fixture(600, 100, stat);
  await assert.rejects(checkVerificationHeadroom('start', f.read, 'linux', f.report));
  const [record] = restoreHeadroomDiagnostics(f.lines[0]).refusals;
  assert.equal(record.cacheCountersValid, true);
  assert.equal(record.reclaimableBytes, 260 * MiB);
  assert.equal(record.chargedBytes, 340 * MiB);
  assert.equal(record.cgroupRefused, false);
  assert.equal(record.hostRefused, true);
  assert.deepEqual(record.probes, Array(4).fill('fulfilled'));
});

test('missing, malformed and inconsistent cache probes retain raw charge and safe parsed evidence', async () => {
  for (const stat of [
    undefined,
    'private malformed data',
    'file 9999999999\nshmem 0\ninactive_file 0\nfile_dirty 0\nfile_writeback 0\n',
  ]) {
    const f = fixture(600);
    if (stat === undefined) delete f.values['/sys/fs/cgroup/memory.stat'];
    else f.values['/sys/fs/cgroup/memory.stat'] = stat;
    await assert.rejects(checkVerificationHeadroom('start', f.read, 'linux', f.report));
    const result = restoreHeadroomDiagnostics(f.lines[0]);
    assert.equal(result.malformed, 0);
    assert.equal(result.refusals[0].cacheCountersValid, false);
    assert.equal(result.refusals[0].chargedBytes, 600 * MiB);
    assert.equal(result.refusals[0].reclaimableBytes, 0);
    assert.equal(
      (result.refusals[0].probes as string[])[3],
      stat === undefined ? 'rejected' : 'fulfilled',
    );
    assert.equal(f.lines[0].includes('private'), false);
  }
});

test('a failing diagnostic sink cannot replace the resource refusal', async () => {
  const f = fixture(600);
  await assert.rejects(
    checkVerificationHeadroom('start', f.read, 'linux', () => {
      throw new Error('diagnostic sink unavailable');
    }),
    new RecoveryResourceError('memory-headroom'),
  );
});

test('unavailable cgroup probes preserve the host guard and never expose native error text', async () => {
  const f = fixture(0, 100);
  delete f.values['/sys/fs/cgroup/memory.max'];
  delete f.values['/sys/fs/cgroup/memory.current'];
  await assert.rejects(checkVerificationHeadroom('start', f.read, 'linux', f.report));
  const [record] = restoreHeadroomDiagnostics(f.lines[0]).refusals;
  assert.equal(record.maximumBytes, null);
  assert.equal(record.usedBytes, null);
  assert.equal(record.chargedBytes, null);
  assert.equal(record.cgroupRefused, false);
  assert.equal(record.hostRefused, true);
  assert.equal(f.lines[0].includes('private'), false);
});

test('the public collector rejects unknown, malformed, oversized and private fields', async () => {
  const f = fixture(600);
  await assert.rejects(checkVerificationHeadroom('start', f.read, 'linux', f.report));
  const valid = JSON.parse(f.lines[0].slice(RECOVERY_HEADROOM_PREFIX.length));
  const invalid = [
    'not JSON',
    'null',
    '[]',
    JSON.stringify({ ...valid, privatePath: '/private/source' }),
    JSON.stringify({ ...valid, phase: 'private-stage' }),
    JSON.stringify({ ...valid, probes: ['fulfilled', 'fulfilled', 'fulfilled', 'private-error'] }),
    JSON.stringify({ ...valid, availableKiB: 'private-content' }),
    JSON.stringify({ ...valid, usedBytes: -1 }),
    JSON.stringify({ ...valid, usedBytes: Number.MAX_SAFE_INTEGER + 1 }),
    JSON.stringify({ ...valid, cgroupRequiredBytes: 1 }),
    JSON.stringify({ ...valid, hostRequiredKiB: 1 }),
    JSON.stringify({ ...valid, hostRefused: false, cgroupRefused: false }),
    ' '.repeat(2049),
  ];
  const result = restoreHeadroomDiagnostics(
    [
      'unrelated private process output',
      ...invalid.map((item) => RECOVERY_HEADROOM_PREFIX + item),
      f.lines[0],
    ].join('\n'),
  );
  assert.equal(result.malformed, invalid.length);
  assert.equal(result.refusals.length, 1);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('the collector retains at most eight ordered observations without claiming failure attribution', async () => {
  const f = fixture(600);
  await assert.rejects(checkVerificationHeadroom('start', f.read, 'linux', f.report));
  const sample = JSON.parse(f.lines[0].slice(RECOVERY_HEADROOM_PREFIX.length));
  const result = restoreHeadroomDiagnostics(
    Array.from(
      { length: 10 },
      (_, index) => RECOVERY_HEADROOM_PREFIX + JSON.stringify({ ...sample, observedAtMs: index }),
    ).join('\n'),
  );
  assert.deepEqual(
    result.refusals.map((item) => item.observedAtMs),
    [2, 3, 4, 5, 6, 7, 8, 9],
  );
  assert.equal(result.omitted, 2);
  assert.equal(result.malformed, 0);
  assert.equal(result.inputTruncated, false);
  const truncated = restoreHeadroomDiagnostics('x'.repeat(17_000) + '\n' + f.lines[0]);
  assert.equal(truncated.inputTruncated, true);
  assert.equal(truncated.refusals.length, 1);
});
