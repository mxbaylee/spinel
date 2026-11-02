import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { ubuntuMirrorEvidence } from './ubuntu-mirror-evidence.ts';

test('public mirror evidence preserves exact line endings, priority and order', () => {
  const original =
    'http://azure.archive.ubuntu.com/ubuntu/ priority:1\r\nhttps://archive.ubuntu.com/ubuntu/ priority:2\nhttp://security.ubuntu.com/ubuntu/ priority:3\n';
  const evidence = ubuntuMirrorEvidence(original);
  assert.equal(evidence.bytes, Buffer.byteLength(original));
  assert.equal(evidence.sha256, createHash('sha256').update(original).digest('hex'));
  assert.deepEqual(
    evidence.lines.map((line) => line.text),
    original.split('\n'),
  );
  assert.deepEqual(
    evidence.lines.map((line) => line.line),
    [1, 2, 3, 4],
  );
});

test('credentials, query strings, arbitrary paths, comments and malformed metadata stay private', () => {
  const lines = [
    'https://private-user:private-password@archive.ubuntu.com/ubuntu/ priority:1',
    'https://archive.ubuntu.com/ubuntu/?private-token priority:1',
    'https://archive.ubuntu.com/private-path/ priority:1',
    '# private-comment',
    'https://private-host.example/ubuntu/ priority:1',
    'https://archive.ubuntu.com/ubuntu/ priority:private-value',
    'private-unrecognized-configuration',
  ];
  const evidence = ubuntuMirrorEvidence(lines.join('\n'));
  assert.ok(evidence.lines.every((line) => line.text === '[unsupported line redacted]'));
  assert.doesNotMatch(JSON.stringify(evidence), /private-/);
  assert.equal(evidence.lines.length, lines.length);
});
