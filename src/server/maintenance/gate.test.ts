import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test, vi } from 'vitest';
import type { DiagnosticEvent, DiagnosticSink } from '@spinel/diagnostics';
import { DatabaseSync } from '../../../server/database.ts';
import type { MaintenanceBridge, MaintenancePublicStatus } from '../../shared/maintenance.ts';
import { MaintenanceError, MaintenanceGate, ShutdownError } from './gate.ts';
import { maintenanceRouter } from './router.ts';

const cleanups: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function fixture(diagnostics?: DiagnosticSink) {
  let status: MaintenancePublicStatus = {
    available: true,
    phase: 'running',
    epoch: 'before',
    notice: null,
  };
  const bridge = { status: () => status } as MaintenanceBridge;
  const gate = new MaintenanceGate(bridge, diagnostics);
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE writes(value TEXT)');
  database.setMaintenanceGate(gate);
  cleanups.push(() => database.close());
  return {
    gate,
    database,
    set: (next: Partial<MaintenancePublicStatus>) => {
      status = { ...status, ...next };
    },
  };
}

test('drain records exact monotonic duration and initial active permits without changing refused or durable work', async () => {
  const events: DiagnosticEvent[] = [];
  const { gate, database, set } = fixture((event) => events.push(event));
  let time = 10;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => time);
  try {
    const done = deferred();
    const writing = gate.run(async () => {
      await done.promise;
      database.prepare('INSERT INTO writes VALUES (?)').run('durable');
    });
    const second = gate.begin();
    set({ phase: 'draining', epoch: 'after' });
    expect(() => gate.run(() => {})).toThrow(MaintenanceError);
    const draining = gate.drain();
    time = 35;
    second.release();
    done.resolve();
    await writing;
    await draining;
    expect(events).toEqual([
      { name: 'maintenance.refused', details: { reason: 'paused' } },
      {
        name: 'maintenance.drain',
        details: { outcome: 'success', admittedCount: 2, durationMs: 25 },
      },
    ]);
    expect(database.prepare('SELECT value FROM writes').all()).toEqual([{ value: 'durable' }]);
    set({ phase: 'running' });
    expect(() => gate.run(() => {}, 'before')).toThrow('Maintenance changed');
    expect(events.at(-1)).toEqual({
      name: 'maintenance.refused',
      details: { reason: 'stale-epoch' },
    });
  } finally {
    clock.mockRestore();
  }
});

test('throwing drain/refusal observers preserve the deadline error and normal admission behavior', async () => {
  const events: DiagnosticEvent[] = [];
  const { gate, set } = fixture((event) => {
    events.push(event);
    throw new Error('broken observer');
  });
  const permit = gate.begin();
  set({ phase: 'draining', epoch: 'after' });
  await expect(gate.drain(1)).rejects.toThrow('Maintenance drain deadline exceeded.');
  expect(events.at(-1)).toMatchObject({
    name: 'maintenance.drain',
    details: { outcome: 'failure', admittedCount: 1 },
  });
  expect(() => gate.run(() => {})).toThrow(MaintenanceError);
  permit.release();
  await expect(gate.drain()).resolves.toBeUndefined();
  expect(events.at(-1)).toMatchObject({
    name: 'maintenance.drain',
    details: { outcome: 'success', admittedCount: 0 },
  });
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('SQLite read lane permits authorization transactions and rejects every write shape', () => {
  const { gate, database, set } = fixture();
  gate.run(() => database.prepare('INSERT INTO writes VALUES (?)').run('kept'), 'before');
  set({ phase: 'paused', epoch: 'after' });
  database.exec('BEGIN IMMEDIATE');
  expect(database.prepare('SELECT value FROM writes').all()).toEqual([{ value: 'kept' }]);
  expect(
    database.prepare('WITH data AS (SELECT value FROM writes) SELECT * FROM data').get(),
  ).toEqual({ value: 'kept' });
  expect(database.prepare('PRAGMA table_info(writes)').all()).toHaveLength(1);
  database.exec('COMMIT');
  for (const sql of [
    "INSERT INTO writes VALUES ('blocked') RETURNING value",
    "WITH data(value) AS (SELECT 'blocked') INSERT INTO writes SELECT value FROM data RETURNING value",
    'DELETE FROM writes RETURNING value',
    'PRAGMA query_only=OFF',
    'PRAGMA user_version(7)',
    "ATTACH DATABASE ':memory:' AS other",
  ])
    expect(() => database.prepare(sql).get(), sql).toThrow(MaintenanceError);
  expect(() => [
    ...database.iterate(
      "WITH data(value) AS (SELECT 'blocked') INSERT INTO writes SELECT value FROM data RETURNING value",
    ),
  ]).toThrow(MaintenanceError);
  for (const sql of [
    'CREATE TABLE sneaky(value)',
    "BEGIN; INSERT INTO writes VALUES ('blocked'); COMMIT;",
    'PRAGMA query_only=OFF',
  ])
    expect(() => database.exec(sql), sql).toThrow(MaintenanceError);
  expect([...database.iterate('SELECT value FROM writes')]).toEqual([{ value: 'kept' }]);
  set({ phase: 'running' });
  gate.run(() => database.prepare('INSERT INTO writes VALUES (?)').run('fresh'), 'after');
  expect(database.prepare('SELECT count(*) AS n FROM writes').get()?.n).toBe(2);
});

test('an abandoned transaction prevents a drained database from being called quiescent', () => {
  const { gate, database, set } = fixture();
  gate.run(() => {
    database.exec('BEGIN IMMEDIATE');
    database.prepare('INSERT INTO writes VALUES (?)').run('uncommitted');
  });
  expect(gate.pending).toBe(0);
  set({ phase: 'draining', epoch: 'after' });
  expect(() => database.assertQuiescent()).toThrow('transaction');
  expect(() => database.exec('COMMIT')).toThrow(MaintenanceError);
  database.exec('ROLLBACK');
  expect(() => database.assertQuiescent()).not.toThrow();
  expect(database.prepare('SELECT count(*) AS n FROM writes').get()?.n).toBe(0);
});

test('drain retains accepted asynchronous work and refuses retired contexts in a later epoch', async () => {
  const { gate, database, set } = fixture();
  const finish = deferred();
  const accepted = gate.run(async () => {
    await finish.promise;
    gate.assertEpoch('before');
    database.prepare('INSERT INTO writes VALUES (?)').run('accepted');
  }, 'before');
  set({ phase: 'draining', epoch: 'after' });
  expect(() => gate.run(() => {})).toThrow(MaintenanceError);
  expect(
    gate.job(() => database.prepare('INSERT INTO writes VALUES (?)').run('job')),
  ).toBeUndefined();
  await expect(gate.drain(5)).rejects.toThrow('deadline');
  finish.resolve();
  await accepted;
  await gate.drain(5);
  set({ phase: 'running' });
  expect(() => gate.run(() => {}, 'before')).toThrow('Maintenance changed');
  const late = deferred();
  let retired!: Promise<unknown>;
  gate.run(() => {
    retired = late.promise.then(() =>
      gate.run(() => database.prepare('INSERT INTO writes VALUES (?)').run('late')),
    );
  });
  late.resolve();
  await expect(retired).rejects.toThrow('Maintenance changed');
  expect(database.prepare('SELECT value FROM writes').all()).toEqual([{ value: 'accepted' }]);
  gate.job(() => database.prepare('INSERT INTO writes VALUES (?)').run('new job'));
  expect(database.prepare('SELECT count(*) AS n FROM writes').get()?.n).toBe(2);
});

test('drain cancels registered long transfers so the deadline covers ordinary writes only', async () => {
  const { gate, set } = fixture();
  const transfer = new AbortController();
  const finished = new AbortController();
  const work = gate.run(
    () =>
      new Promise<void>((resolve) =>
        transfer.signal.addEventListener('abort', () => resolve(), { once: true }),
      ),
  );
  gate.cancelOnDrain(transfer);
  gate.cancelOnDrain(finished)();
  set({ phase: 'draining', epoch: 'after' });
  gate.cancelLongWork();
  expect(transfer.signal.reason).toBeInstanceOf(MaintenanceError);
  expect(finished.signal.aborted).toBe(false);
  await work;
  await gate.drain(5);
  const late = new AbortController();
  gate.cancelOnDrain(late);
  expect(late.signal.reason).toBeInstanceOf(MaintenanceError);
});

test('shutdown cancels long work with its own reason, so a restart is not reported as maintenance', () => {
  const { gate } = fixture();
  const transfer = new AbortController();
  gate.cancelOnDrain(transfer);
  gate.stopAdmission();
  gate.cancelLongWork(new ShutdownError());
  expect(transfer.signal.reason).toBeInstanceOf(ShutdownError);
  const late = new AbortController();
  gate.cancelOnDrain(late);
  expect(late.signal.reason).toBeInstanceOf(ShutdownError);
});

test('real callback body parsing works and HTTP disconnect cannot shorten async drain', async () => {
  const { gate, database, set } = fixture();
  const started = deferred(),
    finish = deferred(),
    completed = deferred();
  const app = express(),
    router = maintenanceRouter();
  app.use(gate.middleware());
  router.use(express.json());
  router.post('/immediate', (request, response) => {
    database.prepare('INSERT INTO writes VALUES (?)').run(request.body.value);
    response.json({ ok: true });
  });
  router.post('/wait', async (_request, response) => {
    started.resolve();
    await finish.promise;
    database.prepare('INSERT INTO writes VALUES (?)').run('after disconnect');
    response.json({ ok: true });
    completed.resolve();
  });
  app.use(router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { 'Content-Type': 'application/json', 'X-Spinel-Epoch': 'before' };
  expect(
    (
      await fetch(`${root}/immediate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ value: 'parsed' }),
      })
    ).status,
  ).toBe(200);
  const controller = new AbortController();
  const request = fetch(`${root}/wait`, {
    method: 'POST',
    headers,
    body: '{}',
    signal: controller.signal,
  }).catch(() => undefined);
  await started.promise;
  set({ phase: 'draining', epoch: 'after' });
  controller.abort();
  await request;
  await expect(gate.drain(10)).rejects.toThrow('deadline');
  finish.resolve();
  await completed.promise;
  await gate.drain(1000);
  expect(database.prepare('SELECT value FROM writes').all()).toEqual([
    { value: 'parsed' },
    { value: 'after disconnect' },
  ]);
  expect(
    (
      await fetch(`${root}/immediate`, {
        method: 'POST',
        headers: { ...headers, 'X-Spinel-Epoch': 'after' },
        body: '{}',
      })
    ).status,
  ).toBe(503);
});
