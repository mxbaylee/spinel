import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configuration, verifyHost } from './preflight.ts';
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

test('host preflight rejects missing, plaintext and nested data mounts while accepting encrypted topology', () => {
  const root = valid.SPINEL_DATA_ROOT;
  let nested = '';
  let missing = '';
  let encrypted = true;
  let rootMounted = true;
  const host = {
    platform: 'linux',
    realpath: (path: string) => path,
    stat: (path: string) => {
      if (path === missing) throw new Error('Missing directory');
      return {
        uid: path.endsWith('/app') || path.endsWith('/recovery') ? 1000 : 10001,
        mode: path.endsWith('.env') ? 0o600 : 0o700,
        isDirectory: () => ['app', 'caddy', 'recovery'].some((name) => path === `${root}/${name}`),
        isSocket: () => path.endsWith('tailscaled.sock'),
        isFile: () => path.endsWith('.env'),
      };
    },
    run: (command: string, args: string[]) => {
      if (command === 'findmnt') {
        if (!rootMounted) return JSON.stringify({ filesystems: [] });
        const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : root;
        return JSON.stringify({
          filesystems: [
            {
              source: target === nested ? '/dev/plain' : '/dev/mapper/data',
              target: target === nested ? nested : root,
            },
          ],
        });
      }
      if (command === 'lsblk')
        return JSON.stringify({
          blockdevices: [{ type: encrypted ? 'crypt' : 'disk', path: '/dev/mapper/data' }],
        });
      if (command === 'cryptsetup') return '  type: LUKS2';
      if (command === 'tailscale')
        return JSON.stringify({
          BackendState: 'Running',
          Self: { TailscaleIPs: [valid.SPINEL_TAILSCALE_IP], DNSName: valid.SPINEL_HOSTNAME + '.' },
        });
      if (command === 'docker') return '{}';
      throw new Error('Unexpected command ' + command);
    },
  };
  assert.equal(verifyHost(valid, host).root, root);
  for (const name of ['app', 'caddy', 'recovery']) {
    nested = `${root}/${name}`;
    assert.throws(() => verifyHost(valid, host), /nested mount/);
    nested = '';
    missing = `${root}/${name}`;
    assert.throws(() => verifyHost(valid, host), /Missing directory/);
    missing = '';
  }
  encrypted = false;
  assert.throws(() => verifyHost(valid, host), /LUKS/);
  encrypted = true;
  rootMounted = false;
  assert.throws(() => verifyHost(valid, host), /mount point/);
});
