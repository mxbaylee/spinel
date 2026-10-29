import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { request } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MaintenanceControlResult } from '../../src/shared/maintenance.ts';
import type { ColdMaintenanceCommand } from '../../src/server/maintenance/supervisor.ts';
import { uuidPattern } from '../../src/server/maintenance/journal.ts';

export async function maintenanceControl(
  root: string,
  command: ColdMaintenanceCommand,
): Promise<MaintenanceControlResult> {
  if (
    process.platform !== 'linux' ||
    !process.getuid ||
    resolve(root) !== root ||
    realpathSync(root) !== root
  )
    throw new Error('Use the configured canonical Linux recovery directory.');
  const directory = lstatSync(root),
    socket = join(root, 'control.sock'),
    info = lstatSync(socket);
  if (
    !directory.isDirectory() ||
    directory.uid !== process.getuid() ||
    directory.mode & 0o077 ||
    !info.isSocket() ||
    info.uid !== process.getuid() ||
    info.mode & 0o077
  )
    throw new Error(
      'Recovery directory and control socket must be private and owned by this user.',
    );
  const payload = JSON.stringify(command);
  return new Promise((resolveResult, reject) => {
    const call = request(
      {
        socketPath: socket,
        path: '/control',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        signal: AbortSignal.timeout(65_000),
      },
      (response) => {
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 32_768) {
            call.destroy(new Error('Recovery response exceeded its limit.'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (response.statusCode !== 200)
              throw new Error(value.error ?? 'Recovery command failed.');
            resolveResult(value as MaintenanceControlResult);
          } catch (error) {
            reject(error);
          }
        });
        response.on('error', reject);
      },
    );
    call.on('error', reject);
    call.end(payload);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [action, option, value, ...extra] = process.argv.slice(2);
  if (
    !action ||
    !['status', 'pause', 'stop', 'start', 'verify', 'resume'].includes(action) ||
    extra.length ||
    (option !== undefined && (option !== '--operation' || !value || !uuidPattern.test(value))) ||
    (action === 'status' && option !== undefined)
  )
    throw new Error(
      'Usage: node scripts/deploy/maintenance.ts status|pause|stop|verify|start|resume [--operation UUID]',
    );
  const root = process.env.SPINEL_MAINTENANCE_ROOT;
  if (!root)
    throw new Error('Set SPINEL_MAINTENANCE_ROOT to the configured private recovery directory.');
  if (action !== 'status' && !value && !['pause', 'verify'].includes(action))
    throw new Error('Use --operation with the exact operation ID from status.');
  const command =
    action === 'status'
      ? ({ action } as const)
      : {
          action: action as Exclude<ColdMaintenanceCommand['action'], 'status'>,
          operationId: value ?? randomUUID(),
        };
  const result = await maintenanceControl(root, command);
  console.log(JSON.stringify(result.status, null, 2));
}
