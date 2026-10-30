import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cpus } from 'node:os';
import { isDiagnosticRecord } from '@spinel/diagnostics';
import type { DiagnosticRecord, DiagnosticSource } from '@spinel/diagnostics';
import { SyncServer } from '@spinel/sync-server';
import type { SubmitFrame } from '@spinel/sync-client';
import { fixture, turns, wire, write } from '../../lib/sync-client/tests/fixture.ts';
import { DiagnosticRateLimit } from '../../src/server/diagnostics/routes.ts';
import { BrowserDiagnostics, DIAGNOSTIC_SAMPLE_INTERVAL_MS } from '../../web/diagnostics.ts';

/**
 * Bounded native/collector measurement, not a renderer/network/disk benchmark.
 * Run with the pinned Node, scripts/serial.ts and the repository memory watchdog.
 * No fragile wall-time ratio gate: content, history, ACK and capacity assertions
 * are gates; alternating raw timings and environment/source identities are evidence.
 */
const SAVE_COUNT = 12;
const WARMUP_PAIRS = 2;
const MEASURED_PAIRS = 6;
const LATER_WINDOW_MS = 60_001;
const fileId = 'e020756e-8c02-4f97-a93c-4172d78e9c45';
function collector() {
  const received: DiagnosticRecord[] = [];
  const batches: { records: number; status: number }[] = [];
  let offsetMs = 0;
  let verifications = 0;
  const accountId = 'b555ee64-7a57-4f60-9818-65f90503d729';
  const now = () => Date.now() + offsetMs;
  const rate = new DiagnosticRateLimit(now);
  const diagnostics = new BrowserDiagnostics({
    accountId,
    now,
    monotonicNow: () => performance.now() + offsetMs,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/collection')) {
        verifications++;
        return Response.json({
          generation: '823469fc-ad72-4c99-aa7b-fb02739c9dd5',
          binding: 'a'.repeat(64),
        });
      }
      const body = JSON.parse(String(init?.body)) as { records: DiagnosticRecord[] };
      assert(body.records.every(isDiagnosticRecord));
      assert(body.records.length <= 64);
      assert(Buffer.byteLength(String(init?.body)) <= 64 * 1024);
      const admitted = rate.take(accountId, body.records.length);
      batches.push({ records: body.records.length, status: admitted ? 200 : 429 });
      if (!admitted) return Response.json({ error: 'Rate limit' }, { status: 429 });
      received.push(...body.records);
      return Response.json({ accepted: body.records.length, dropped: 0 });
    }) as typeof fetch,
  });
  return {
    diagnostics,
    received,
    batches,
    verifications: () => verifications,
    advanceWindow() {
      offsetMs += LATER_WINDOW_MS;
    },
  };
}

function fillQueue(diagnostics: BrowserDiagnostics, count: number) {
  for (let index = 0; index < count; index++)
    diagnostics.capture()?.(
      {
        name: 'operation.result',
        details: { operation: 'document-save-local', outcome: 'failure', durationMs: 0 },
      },
      { component: 'editor', fileId },
    );
}

function losses(diagnostics: BrowserDiagnostics) {
  return {
    dropped: diagnostics.dropped,
    sampledOut: diagnostics.sampledOut,
    otherDropped: diagnostics.dropped - diagnostics.sampledOut,
  };
}

async function workload(mode: 'off' | 'on' | 'saturated') {
  const enabled = mode !== 'off';
  const collection = collector();
  await collection.diagnostics.start();
  if (mode === 'saturated') fillQueue(collection.diagnostics, 500);
  const beforeNative = losses(collection.diagnostics);
  const diagnostics: DiagnosticSource | undefined = enabled
    ? () => {
        const sink = collection.diagnostics.capture();
        return sink
          ? {
              sink,
              context: { component: 'editor', fileId, route: '/files/:id', runId: randomUUID() },
            }
          : undefined;
      }
    : undefined;
  const f = fixture();
  let authorized = true;
  let authorizationChecks = 0;
  const authoritative = new SyncServer<void>(f.storage, {
    authorize() {
      authorizationChecks++;
      if (!authorized) throw new Error('The synthetic editor grant was revoked');
    },
  });
  const accept = (request: SubmitFrame) =>
    authoritative.submit(
      {
        ...structuredClone(request),
        unitId: f.storage.unit.unitId,
        actorId: 'a',
      },
      undefined,
    );
  const writer = f.client({ diagnostics });
  const peer = f.client({ diagnostics });
  let collectorFlushMs = 0;
  let transportDrops = 0;
  const flush = async () => {
    const before = collection.diagnostics.dropped;
    const started = performance.now();
    // Four calls drain the bounded queue, or stop naturally after a real 429.
    for (let batch = 0; batch < 4; batch++) await collection.diagnostics.flush();
    collectorFlushMs += performance.now() - started;
    transportDrops += collection.diagnostics.dropped - before;
  };
  const saves = () =>
    collection.received.filter(
      ({ event }) =>
        event.name === 'operation.count' && event.details.operation === 'document-save-server-ack',
    ).length;
  try {
    writer.resume();
    peer.resume();
    await turns();
    const save = async (value: string, row: number) => {
      writer.edit([write({ v: value }, row)]);
      writer.sync.retry();
      await turns();
      const request = writer.submits().at(-1)!;
      writer.sync.retry();
      const committed = await accept(request);
      const receipt = await accept(request);
      assert.equal(receipt.duplicate, true);
      const ack = {
        type: 'ack' as const,
        mutationId: request.mutationId,
        duplicate: receipt.duplicate,
        ...wire(committed.edit),
      };
      writer.sync.receive(ack);
      writer.sync.receive(ack);
      peer.sync.receive({ type: 'edit', ...wire(committed.edit) });
      await turns();
      assert.equal(writer.sync.state.pending, false);
      assert.equal(peer.sync.state.pending, false);
    };
    const started = performance.now();
    for (let index = 0; index < SAVE_COUNT; index++) await save(`synthetic-${index}`, index);
    const nativeDurationMs = performance.now() - started;
    const afterMeasuredNative = losses(collection.diagnostics);
    assert.equal(f.storage.history.length, SAVE_COUNT);
    assert.equal(writer.sync.confirmedRevision, SAVE_COUNT + 1);
    if (mode !== 'saturated') await flush();
    const firstWindowDiagnosticSaveCounters = saves();
    assert.equal(firstWindowDiagnosticSaveCounters, mode === 'on' ? 1 : 0);
    // The policy clock advances only outside native timing. Real clock reads and
    // the same active collector remain in use; no lifecycle restart or replay.
    collection.advanceWindow();
    assert(collection.diagnostics.capture());
    await save('synthetic-later', 0);
    const beforeFinalTransport = losses(collection.diagnostics);
    assert.deepEqual(writer.live.snapshot(), peer.live.snapshot());
    assert.deepEqual(
      { ...writer.live.snapshot(), rev: writer.sync.confirmedRevision },
      f.storage.unit.snapshot,
    );
    assert.equal(f.storage.history.length, SAVE_COUNT + 1);
    assert.equal(writer.sync.confirmedRevision, SAVE_COUNT + 2);
    const state = {
      unit: f.storage.unit,
      history: f.storage.history,
      writer: writer.live.snapshot(),
      peer: peer.live.snapshot(),
    };
    const nativeStateSha256 = createHash('sha256').update(JSON.stringify(state)).digest('hex');
    const beforeRefusal = structuredClone({ unit: f.storage.unit, history: f.storage.history });
    authorized = false;
    // Current authorization must still deny both new writes and access to a
    // previously accepted receipt under disabled, normal or saturated collection.
    await assert.rejects(accept(writer.submits().at(-1)!), /grant was revoked/);
    await assert.rejects(
      accept({
        type: 'submit',
        mutationId: 'revoked',
        baseRevision: SAVE_COUNT + 2,
        mutations: [write({ v: 'must never be committed' })],
      }),
      /grant was revoked/,
    );
    assert.deepEqual({ unit: f.storage.unit, history: f.storage.history }, beforeRefusal);
    await flush();
    const finalLosses = losses(collection.diagnostics);
    const nativeQueueDrops = beforeFinalTransport.otherDropped - beforeNative.otherDropped;
    if (mode === 'saturated') {
      assert(afterMeasuredNative.otherDropped > beforeNative.otherDropped);
      assert(nativeQueueDrops > 0);
      assert.equal(saves(), 0);
      assert.deepEqual(collection.batches, [
        { records: 64, status: 200 },
        { records: 64, status: 429 },
      ]);
      assert.equal(transportDrops, 192);
    } else {
      assert.equal(saves(), enabled ? 2 : 0);
      assert.equal(nativeQueueDrops, 0);
      assert.equal(transportDrops, 0);
      assert(collection.batches.every(({ status }) => status === 200));
    }
    assert.equal(collection.verifications(), 1);
    assert.equal(finalLosses.otherDropped, beforeFinalTransport.otherDropped + transportDrops);
    if (enabled) assert(finalLosses.sampledOut > 0);
    return {
      enabled,
      mode,
      nativeDurationMs,
      perSaveMs: nativeDurationMs / SAVE_COUNT,
      collectorFlushMs,
      records: collection.received.length,
      ...finalLosses,
      lossBreakdown: {
        queueOverflowBeforeNative: beforeNative.otherDropped,
        measuredNativeQueueOverflow: afterMeasuredNative.otherDropped - beforeNative.otherDropped,
        allNativeQueueOverflow: nativeQueueDrops,
        transportDrops,
      },
      firstWindowDiagnosticSaveCounters,
      laterWindowDiagnosticSaveCounters: saves() - firstWindowDiagnosticSaveCounters,
      diagnosticSaveCounters: saves(),
      batches: collection.batches,
      collectionVerifications: collection.verifications(),
      nativeStateSha256,
      assertions: {
        identicalNativeContentAndResources: true,
        measuredSaves: SAVE_COUNT,
        untimedLaterSaves: 1,
        acceptedHistoryRows: SAVE_COUNT + 1,
        successfulAcknowledgments: SAVE_COUNT + 1,
        duplicateSubmissionsRetainOneHistoryRow: true,
        duplicateAcknowledgmentsPreserveSavedState: true,
        bothClientsSaved: true,
        laterSaveWithoutCollectionTransition: true,
        revokedWritesAndReceiptsDenied: true,
        refusalPreservesEveryStoredRow: true,
        authorizationChecks,
      },
    };
  } finally {
    authoritative.close();
    f.close();
    collection.diagnostics.stop();
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
}

export async function measureDiagnosticsOverhead() {
  for (let pair = 0; pair < WARMUP_PAIRS; pair++) {
    await workload(pair % 2 === 0 ? 'off' : 'on');
    await workload(pair % 2 === 0 ? 'on' : 'off');
  }
  const measurements = [];
  for (let pair = 0; pair < MEASURED_PAIRS; pair++) {
    measurements.push(await workload(pair % 2 === 0 ? 'off' : 'on'));
    measurements.push(await workload(pair % 2 === 0 ? 'on' : 'off'));
  }
  const saturatedMeasurements = [await workload('saturated'), await workload('saturated')];
  for (const measured of [...measurements, ...saturatedMeasurements])
    assert.equal(measured.nativeStateSha256, measurements[0].nativeStateSha256);
  const pressure = collector();
  try {
    await pressure.diagnostics.start();
    fillQueue(pressure.diagnostics, 500);
    const observedDrops = pressure.diagnostics.dropped;
    assert.equal(observedDrops, 500 - 256);
    assert.equal(pressure.diagnostics.sampledOut, 0);
    for (let batch = 0; batch < 4; batch++) await pressure.diagnostics.flush();
    assert.equal(pressure.received.length, 64);
    assert.equal(pressure.diagnostics.dropped - observedDrops, 192);
    assert.deepEqual(pressure.batches, [
      { records: 64, status: 200 },
      { records: 64, status: 429 },
    ]);
    const sourcePaths = [
      ...[
        'lib/diagnostics',
        'lib/sync-client/src',
        'lib/sync-server/src',
        'lib/sync-transform/src',
      ].flatMap((directory) =>
        readdirSync(directory)
          .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
          .map((name) => `${directory}/${name}`),
      ),
      'lib/sync-client/index.ts',
      'lib/sync-client/tests/fixture.ts',
      'lib/sync-server/index.ts',
      'lib/sync-transform/index.ts',
      'package-lock.json',
      'scripts/dependencies/patch-univer-core.ts',
      'scripts/dependencies/patch-univer-docs.ts',
      'node_modules/@univerjs/core/lib/es/index.js',
      'node_modules/@univerjs/core/lib/cjs/index.js',
      'node_modules/@univerjs/docs/lib/es/index.js',
      'node_modules/@univerjs/docs/lib/cjs/index.js',
      'src/server/diagnostics/routes.ts',
      'web/diagnostics.ts',
      'scripts/ci/diagnostics-overhead.ts',
    ].sort();
    const off = measurements.filter((run) => !run.enabled).map((run) => run.perSaveMs);
    const on = measurements.filter((run) => run.enabled).map((run) => run.perSaveMs);
    return {
      schemaVersion: 3,
      measuredAt: new Date().toISOString(),
      runtime: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        cpuCount: cpus().length,
      },
      source: {
        baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        note: 'Source-file and installed SDK hashes identify the measured working tree; baseCommit alone is not the complete tested source.',
        sha256: Object.fromEntries(
          sourcePaths.map((path) => [
            path,
            createHash('sha256').update(readFileSync(path)).digest('hex'),
          ]),
        ),
      },
      method: {
        warmupPairs: WARMUP_PAIRS,
        measuredPairs: MEASURED_PAIRS,
        measuredSavesPerRun: SAVE_COUNT,
        untimedLaterSavesPerRun: 1,
        order: 'Alternating off/on then on/off pairs',
        clock: 'performance.now monotonic milliseconds',
        policyClock:
          'Real Date.now/performance.now reads plus an offset advanced only once, outside timing, before the later save; no collector lifecycle transition',
        laterWindowAdvanceMs: LATER_WINDOW_MS,
        sampleIntervalMs: DIAGNOSTIC_SAMPLE_INTERVAL_MS,
        enabledCollector:
          'Real BrowserDiagnostics complete-bundle sampling, queue, schema validation, UUID/context creation, serialization and batching; in-memory HTTP sink uses actual DiagnosticRateLimit',
        included:
          'Native Sheet mutation admission, real SyncServer materialization/receipts, peer application, two duplicate sends/ACK deliveries, collector enqueue',
        excluded:
          'Account-shell lifecycle/HTTP verification, initial SDK construction, browser rendering, real network/SQLite/IDB, the thirteenth native save and collector HTTP flush (reported separately)',
        timingGate:
          'No ratio-only threshold; bounded workload and resource watchdog plus exact behavioral/capacity assertions',
        saturatedValidation:
          'Two native workloads begin with the real collector full of failure observations that bypass sampling. All 13 native saves and final content/history/access/peer hashes match off/on runs. Queue losses before transport, sampling omissions and the subsequent real 429/queue discard are distinct. No pressure batch is spaced artificially to manufacture admission; stop cancels the retry timer.',
      },
      summary: {
        offMedianMsPerSave: median(off),
        onMedianMsPerSave: median(on),
        medianDeltaMsPerSave: median(on) - median(off),
        offRangeMsPerSave: [Math.min(...off), Math.max(...off)],
        onRangeMsPerSave: [Math.min(...on), Math.max(...on)],
        warning:
          'A small in-process sample describes this workload only and does not explain old unprofiled pauses.',
      },
      measurements,
      saturatedMeasurements,
      pressure: {
        attempted: 500,
        queuedBeforeTransport: 256,
        queueOverflow: observedDrops,
        sampledOut: pressure.diagnostics.sampledOut,
        admittedRecords: pressure.received.length,
        transportDrops: pressure.diagnostics.dropped - observedDrops,
        totalDropped: pressure.diagnostics.dropped,
        batches: pressure.batches,
        queueLimitEnforced: true,
      },
    };
  } finally {
    pressure.diagnostics.stop();
  }
}

if (import.meta.main) {
  const result = await measureDiagnosticsOverhead();
  const output = process.argv[2] ?? 'docs/implementation/evidence/SPN-123-overhead.json';
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ output, summary: result.summary, pressure: result.pressure }));
}
