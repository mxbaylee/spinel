import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cpus } from 'node:os';
import { isDiagnosticRecord } from '@spinel/diagnostics';
import type { DiagnosticRecord, DiagnosticSource } from '@spinel/diagnostics';
import { SyncServer } from '@spinel/sync-server';
import type { SubmitFrame } from '@spinel/sync-client';
import { fixture, turns, wire, write } from '../../lib/sync-client/tests/fixture.ts';
import { BrowserDiagnostics } from '../../web/diagnostics.ts';

/**
 * Bounded native/collector measurement, not a renderer/network/disk benchmark.
 * Run with the pinned Node, scripts/serial.ts and the repository memory watchdog.
 * No fragile wall-time ratio gate: content, history, ACK and capacity assertions
 * are gates; alternating raw timings and environment/source identities are evidence.
 */
const SAVE_COUNT = 12;
const WARMUP_PAIRS = 2;
const MEASURED_PAIRS = 6;
const fileId = 'e020756e-8c02-4f97-a93c-4172d78e9c45';
function collector() {
  const received: DiagnosticRecord[] = [];
  const batchSizes: number[] = [];
  const diagnostics = new BrowserDiagnostics({
    accountId: 'b555ee64-7a57-4f60-9818-65f90503d729',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/collection'))
        return Response.json({
          generation: '823469fc-ad72-4c99-aa7b-fb02739c9dd5',
          binding: 'a'.repeat(64),
        });
      const body = JSON.parse(String(init?.body)) as { records: DiagnosticRecord[] };
      assert(body.records.every(isDiagnosticRecord));
      assert(body.records.length <= 64);
      assert(Buffer.byteLength(String(init?.body)) <= 64 * 1024);
      batchSizes.push(body.records.length);
      received.push(...body.records);
      return Response.json({ accepted: body.records.length, dropped: 0 });
    }) as typeof fetch,
  });
  return { diagnostics, received, batchSizes };
}

function fillQueue(diagnostics: BrowserDiagnostics, count: number) {
  for (let index = 0; index < count; index++)
    diagnostics.emit(
      {
        name: 'operation.count',
        metric: { kind: 'counter', unit: 'count', value: 1 },
        details: { operation: 'document-save-local', outcome: 'success' },
      },
      { component: 'editor', fileId },
    );
}

async function workload(mode: 'off' | 'on' | 'saturated') {
  const enabled = mode !== 'off';
  const collection = collector();
  await collection.diagnostics.start();
  if (mode === 'saturated') fillQueue(collection.diagnostics, 500);
  const droppedBeforeNative = collection.diagnostics.dropped;
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
  try {
    writer.resume();
    peer.resume();
    await turns();
    const started = performance.now();
    for (let index = 0; index < SAVE_COUNT; index++) {
      writer.edit([write({ v: `synthetic-${index}` }, index)]);
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
    }
    const nativeDurationMs = performance.now() - started;
    assert.deepEqual(writer.live.snapshot(), peer.live.snapshot());
    assert.deepEqual(
      { ...writer.live.snapshot(), rev: writer.sync.confirmedRevision },
      f.storage.unit.snapshot,
    );
    assert.equal(f.storage.history.length, SAVE_COUNT);
    assert.equal(writer.sync.confirmedRevision, SAVE_COUNT + 1);
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
        baseRevision: SAVE_COUNT + 1,
        mutations: [write({ v: 'must never be committed' })],
      }),
      /grant was revoked/,
    );
    assert.deepEqual({ unit: f.storage.unit, history: f.storage.history }, beforeRefusal);
    const flushStarted = performance.now();
    for (let batch = 0; batch < 4; batch++) await collection.diagnostics.flush();
    const collectorFlushMs = performance.now() - flushStarted;
    const saves = collection.received.filter(
      ({ event }) =>
        event.name === 'operation.count' && event.details.operation === 'document-save-server-ack',
    );
    if (mode === 'saturated') {
      assert(collection.diagnostics.dropped > droppedBeforeNative);
      assert(saves.length <= SAVE_COUNT);
    } else {
      assert.equal(saves.length, enabled ? SAVE_COUNT : 0);
      assert.equal(collection.diagnostics.dropped, 0);
    }
    return {
      enabled,
      mode,
      nativeDurationMs,
      perSaveMs: nativeDurationMs / SAVE_COUNT,
      collectorFlushMs,
      records: collection.received.length,
      dropped: collection.diagnostics.dropped,
      nativeObservationDrops: collection.diagnostics.dropped - droppedBeforeNative,
      diagnosticSaveCounters: saves.length,
      nativeStateSha256,
      assertions: {
        identicalNativeContentAndResources: true,
        acceptedHistoryRows: SAVE_COUNT,
        successfulAcknowledgments: SAVE_COUNT,
        duplicateDeliveryCountedOnce: true,
        bothClientsSaved: true,
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
    for (let batch = 0; batch < 4; batch++) await pressure.diagnostics.flush();
    assert.equal(pressure.received.length, 256);
    assert.deepEqual(pressure.batchSizes, [64, 64, 64, 64]);
    const sourcePaths = [
      'lib/diagnostics/index.ts',
      'lib/diagnostics/client.ts',
      'lib/sync-client/src/client.ts',
      'lib/sync-client/src/types.ts',
      'lib/sync-client/tests/fixture.ts',
      'lib/sync-server/src/server.ts',
      'lib/sync-server/src/types.ts',
      'package-lock.json',
      'web/diagnostics.ts',
      'scripts/ci/diagnostics-overhead.ts',
    ];
    const off = measurements.filter((run) => !run.enabled).map((run) => run.perSaveMs);
    const on = measurements.filter((run) => run.enabled).map((run) => run.perSaveMs);
    return {
      schemaVersion: 2,
      measuredAt: new Date().toISOString(),
      runtime: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        cpuCount: cpus().length,
      },
      source: {
        baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        note: 'Source-file hashes identify the measured working tree; baseCommit alone is not the complete tested source.',
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
        savesPerRun: SAVE_COUNT,
        order: 'Alternating off/on then on/off pairs',
        clock: 'performance.now monotonic milliseconds',
        enabledCollector:
          'Real BrowserDiagnostics queue, schema validation, UUID/context creation, serialization and batching; in-memory HTTP sink',
        included:
          'Native Sheet mutation admission, real SyncServer materialization/receipts, peer application, two duplicate sends/ACK deliveries, collector enqueue',
        excluded:
          'Account-shell lifecycle/HTTP verification, initial SDK construction, browser rendering, real network/SQLite/IDB and final collector HTTP flush (reported separately)',
        timingGate:
          'No ratio-only threshold; bounded workload and resource watchdog plus exact behavioral/capacity assertions',
        saturatedValidation:
          'Two native workloads begin with the real collector already full. Native observations must add visible drops; content/history/ACK/access/save/peer assertions and final state hashes match every off/on run. Missing diagnostic counters are disclosed, not reconstructed.',
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
        retained: 256,
        visiblyDropped: observedDrops,
        batchSizes: pressure.batchSizes,
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
