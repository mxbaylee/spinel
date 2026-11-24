import assert from 'node:assert/strict';
import { test } from 'node:test';
import { upgradeTraceBuffer } from '../../e2e/offline-upgrade-observation.ts';

const worker = { cat: 'ServiceWorker', name: 'ServiceWorkerVersion::Request', ph: 'b', ts: 1 };

test('a complete worker capture retains the source events and requires a lossless terminal', () => {
  const capture = upgradeTraceBuffer();
  const events = [worker, { ...worker, ph: 'e', ts: 2 }];
  capture.append(events);
  assert.equal(capture.result(undefined).complete, false);
  assert.equal(capture.result({ dataLossOccurred: true }).complete, false);
  const result = capture.result({ dataLossOccurred: false });
  assert.equal(result.complete, true);
  assert.equal(result.sourceEvents, 2);
  assert.deepEqual(result.events, events);
});

test('empty, metadata-only and malformed captures cannot imply no pending work', () => {
  for (const events of [[], [{ cat: '__metadata' }], [worker, null], [worker, []]]) {
    const capture = upgradeTraceBuffer();
    capture.append(events);
    assert.equal(capture.result({ dataLossOccurred: false }).complete, false);
  }
  const capture = upgradeTraceBuffer();
  capture.append({ value: worker });
  capture.append([worker]);
  assert.equal(capture.result({ dataLossOccurred: false }).complete, false);
});

test('object-shaped malformed events cannot certify a worker capture', () => {
  for (const events of [
    [{ cat: 'ServiceWorker' }],
    [worker, {}],
    [worker, { cat: 'ServiceWorker', name: 7, ph: null, ts: 'invalid' }],
  ]) {
    const capture = upgradeTraceBuffer();
    capture.append(events);
    const result = capture.result({ dataLossOccurred: false });
    assert.equal(result.complete, false);
    assert.equal(result.malformed, 1);
    assert.equal(result.workerEvents, events.length - 1);
  }
});

test('valid metadata and raw worker payloads survive without metadata implying activity', () => {
  const metadata = { name: 'thread_name', ph: 'M', args: { name: 'WorkerThread' } };
  const labelledMetadata = { ...metadata, cat: 'ServiceWorker', ts: 0 };
  const capture = upgradeTraceBuffer();
  capture.append([metadata, labelledMetadata]);
  assert.equal(capture.result({ dataLossOccurred: false }).complete, false);
  const event = { ...worker, args: { requestId: 'synthetic-fixture-request' } };
  const end = { ...worker, ph: 'E', name: '', ts: 2 };
  capture.append([event, end]);
  const result = capture.result({ dataLossOccurred: false });
  assert.equal(result.complete, true);
  assert.equal(result.workerEvents, 2);
  assert.equal(result.malformed, 0);
  assert.deepEqual(result.events, [metadata, labelledMetadata, event, end]);
});

test('event and byte limits preserve the prefix while explicitly rejecting overflow', () => {
  const capture = upgradeTraceBuffer();
  capture.append(Array.from({ length: 16_385 }, (_, id) => ({ ...worker, id })));
  const result = capture.result({ dataLossOccurred: false });
  assert.equal(result.retainedEvents, 16_384);
  assert.equal(result.sourceEvents, 16_385);
  assert.equal(result.dropped, 1);
  assert.equal(result.events[0]!.id, 0);
  assert.equal(result.complete, false);

  const bytes = upgradeTraceBuffer();
  bytes.append([worker, { ...worker, args: 'x'.repeat(4 * 1024 * 1024) }]);
  const overflow = bytes.result({ dataLossOccurred: false });
  assert.equal(overflow.retainedEvents, 1);
  assert.equal(overflow.dropped, 1);
  assert.equal(overflow.complete, false);
  assert.deepEqual(overflow.events, [worker]);
});
