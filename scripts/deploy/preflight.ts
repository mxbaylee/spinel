import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export function configuration(env: NodeJS.ProcessEnv) {
  const hostname = env.SPINEL_HOSTNAME ?? '';
  const ip = env.SPINEL_TAILSCALE_IP ?? '';
  const root = env.SPINEL_DATA_ROOT ?? '';
  const image = env.SPINEL_IMAGE ?? '';
  if (!/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(hostname))
    throw new Error('Set SPINEL_HOSTNAME to this machine’s exact .ts.net hostname.');
  const parts = ip.split('.').map(Number);
  if (
    !/^\d+\.\d+\.\d+\.\d+$/.test(ip) ||
    parts[0] !== 100 ||
    parts[1] < 64 ||
    parts[1] > 127 ||
    parts.some((n) => n < 0 || n > 255)
  )
    throw new Error('Set SPINEL_TAILSCALE_IP to the machine’s tailnet IPv4 address.');
  if (!isAbsolute(root) || root === '/')
    throw new Error('Set SPINEL_DATA_ROOT to an absolute encrypted mount path.');
  if (!/^(?:[a-zA-Z0-9./:_-]+@)?sha256:[a-f0-9]{64}$/.test(image))
    throw new Error('SPINEL_IMAGE must identify a built image by immutable SHA-256 digest.');
  return { hostname, ip, root, image };
}
interface BlockDevice {
  type: string;
  path?: string;
  children?: BlockDevice[];
}
export function verifyHost(env: NodeJS.ProcessEnv) {
  if (process.platform !== 'linux')
    throw new Error('Deployment preflight requires the target Linux host.');
  const config = configuration(env);
  const run = (command: string, args: string[]) =>
    execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (realpathSync(config.root) !== config.root)
    throw new Error('Encrypted mount path must be canonical, without symlinks.');
  const mount = JSON.parse(
    run('findmnt', ['--json', '--mountpoint', config.root, '--output', 'SOURCE,TARGET']),
  ).filesystems?.[0];
  if (!mount || mount.target !== config.root)
    throw new Error(
      'The data path is not an active mount point. Unlock and mount the LUKS volume first.',
    );
  const devices = JSON.parse(
    run('lsblk', ['--json', '--inverse', '--output', 'TYPE,PATH', mount.source]),
  ).blockdevices;
  const encryptedPaths = (items: BlockDevice[]): string[] =>
    items.flatMap((item) => [
      ...(item.type === 'crypt' && item.path ? [item.path] : []),
      ...encryptedPaths(item.children ?? []),
    ]);
  if (
    !encryptedPaths(devices ?? []).some((path) =>
      /^\s*type:\s+LUKS[12]\s*$/m.test(run('cryptsetup', ['status', path])),
    )
  ) {
    throw new Error(
      'The mounted data device has no active LUKS ancestor. Refusing unencrypted storage.',
    );
  }
  for (const [name, uid] of [
    ['app', 1000],
    ['caddy', 10001],
  ] as const) {
    const path = `${config.root}/${name}`;
    const stat = statSync(path);
    if (
      !stat.isDirectory() ||
      stat.uid !== uid ||
      realpathSync(path) !== path ||
      (stat.mode & 0o007) !== 0
    )
      throw new Error(`Prepare ${name} with owner ${uid} and no access for other users.`);
  }
  const status = JSON.parse(run('tailscale', ['status', '--json']));
  if (
    status.BackendState !== 'Running' ||
    !status.Self?.TailscaleIPs?.includes(config.ip) ||
    status.Self.DNSName?.replace(/\.$/, '') !== config.hostname
  )
    throw new Error('Configured hostname/IP do not match this running Tailscale node.');
  const socket = statSync('/var/run/tailscale/tailscaled.sock');
  if (!socket.isSocket()) throw new Error('Tailscale local socket is unavailable.');
  const runtime = env.SPINEL_RUNTIME_ENV ?? '/etc/spinel/runtime.env';
  const stat = statSync(runtime);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0)
    throw new Error('Runtime environment file must be private (mode0600).');
  run('docker', ['image', 'inspect', config.image]);
  return config;
}
