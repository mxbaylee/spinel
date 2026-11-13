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
