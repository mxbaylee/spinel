import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configuration } from './preflight.ts';
const valid = {
  SPINEL_HOSTNAME: 'spinel.example.ts.net',
  SPINEL_TAILSCALE_IP: '100.64.0.5',
  SPINEL_DATA_ROOT: '/srv/spinel/data',
  SPINEL_IMAGE: `sha256:${'a'.repeat(64)}`,
};
test('deployment rejects public binds, non-tailnet names, unsafe paths and mutable images', () => {
  assert.equal(configuration(valid).ip, '100.64.0.5');
  for (const ip of [
    '0.0.0.0',
    '127.0.0.1',
    '100.63.0.1',
    '100.128.0.1',
    '100.64.0.256',
    '100.64.0.1 extra',
  ])
    assert.throws(() => configuration({ ...valid, SPINEL_TAILSCALE_IP: ip }));
  for (const name of [
    'example.com',
    'https://spinel.example.ts.net',
    'spinel.example.ts.net/path',
    'spinel.example.ts.net\nmalicious',
  ])
    assert.throws(() => configuration({ ...valid, SPINEL_HOSTNAME: name }));
  for (const root of ['/', 'data', ''])
    assert.throws(() => configuration({ ...valid, SPINEL_DATA_ROOT: root }));
  for (const image of ['spinel:latest', 'spinel:main', ''])
    assert.throws(() => configuration({ ...valid, SPINEL_IMAGE: image }));
});
