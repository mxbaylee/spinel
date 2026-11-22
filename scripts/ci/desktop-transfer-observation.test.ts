import assert from 'node:assert/strict';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { test } from 'node:test';
import { desktopTransferObservation } from './desktop-transfer-observation.ts';

const response = () => new ServerResponse(new IncomingMessage(new Socket()));

test('transfer observation identifies admitted overlap without content or credentials', () => {
  const holders = new WeakSet<ServerResponse>();
  const observer = desktopTransferObservation((value) => holders.has(value));
  const bundle = response();
  observer.observe({ url: '/api/items/private-id/offline-bundle?token=private-token' }, bundle);
  holders.add(bundle);
  // A disconnected request may still own admission while its materializer runs.
  bundle.emit('close');
  const recovery = response();
  observer.observe({ url: '/api/items/offline-recovery' }, recovery);
  recovery.statusCode = 429;
  recovery.writeHead(429);
  recovery.emit('finish');
  recovery.emit('close');
  const evidence = observer.snapshot();
  assert.deepEqual(
    evidence.requests.map((row) => row.admittedAtStart),
    [[], [1]],
  );
  assert.equal(evidence.requests[0].admittedAtClose, true);
  assert.equal(evidence.requests[0].status, undefined);
  assert.equal(evidence.requests[1].status, 429);
  assert.ok(evidence.requests[1].finishedMs! >= evidence.requests[1].startedMs);
  assert.ok(evidence.requests[1].closedMs! >= evidence.requests[1].finishedMs!);
  assert.equal(JSON.stringify(evidence).includes('private'), false);
  assert.equal(evidence.unreadable, 0);
});

test('unrelated requests stay absent and observations are bounded with truthful losses', () => {
  const observer = desktopTransferObservation(() => false);
  observer.observe({ url: '/api/items/private-id/images/private-hash' }, response());
  for (let index = 0; index < 260; index++) {
    const current = response();
    observer.observe({ url: '/api/items/private-id/offline-bundle' }, current);
    current.emit('close');
  }
  const evidence = observer.snapshot();
  assert.equal(evidence.requests.length, 256);
  assert.equal(evidence.total, 260);
  assert.equal(evidence.dropped, 4);
  assert.equal(evidence.unreadable, 0);
  evidence.requests.length = 0;
  assert.equal(observer.snapshot().requests.length, 256);
});

test('observation failures cannot throw into request or response handling', () => {
  const observer = desktopTransferObservation(() => {
    throw new Error('observation failed');
  });
  const first = response();
  observer.observe({ url: '/api/items/private-id/export' }, first);
  assert.doesNotThrow(() => first.emit('close'));
  assert.doesNotThrow(() => observer.observe({ url: '/api/items/offline-recovery' }, response()));
  assert.equal(observer.snapshot().unreadable, 2);
});
