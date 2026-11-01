/** Acceptance-only metadata observer. No process enters the serving PID namespace. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
type DockerCommand = (
  args: string[],
  limits: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;
const docker: DockerCommand = (args, limits) => run('docker', args, limits);

/** Observer containment must survive a rejected serving cleanup or proof write. */
export async function containRestoreObserver(
  work: () => Promise<void>,
  close: () => Promise<boolean>,
) {
  let workCompleted = false;
  let observerClosed = false;
  try {
    await work();
    workCompleted = true;
  } catch {
    /* Retain failure; continue independent containment. */
  } finally {
    try {
      observerClosed = await close();
    } catch {
      /* Unconfirmed closure is never success. */
    }
  }
  return { workCompleted, observerClosed };
}
function closedState(value: any) {
  if (
    !value ||
    typeof value.Running !== 'boolean' ||
    !Number.isSafeInteger(value.Pid) ||
    value.Pid < 0 ||
    !Number.isInteger(value.ExitCode) ||
    typeof value.OOMKilled !== 'boolean'
  )
    return null;
  return {
    running: value.Running,
    pid: value.Pid,
    exitCode: value.ExitCode,
    oomKilled: value.OOMKilled,
  };
}
const idle = 'trap "exit 0" TERM INT; sleep 600 & wait';
export class RestoreObserver {
  readonly evidence: Record<string, unknown> = {
    scope: 'Separate read-only metadata observer; excluded from serving cgroup measurements',
    sqliteOpened: false,
  };
  private attempted = false;
  private closed?: Promise<boolean>;
  private ownedId?: string;
  private readonly execute: DockerCommand;
  private readonly options: { name: string; volume: string; image: string; user: string };
  constructor(
    options: { name: string; volume: string; image: string; user: string },
    execute: DockerCommand = docker,
  ) {
    this.options = options;
    this.execute = execute;
  }
  private async inspect() {
    const { stdout } = await this.execute(['inspect', this.ownedId ?? this.options.name], {
      timeout: 3000,
      maxBuffer: 32_768,
    });
    return JSON.parse(stdout)[0];
  }
  private async absent() {
    const { stdout } = await this.execute(
      [
        'container',
        'ls',
        '--all',
        '--filter',
        `name=^/${this.options.name}$`,
        '--format',
        '{{.ID}}',
      ],
      { timeout: 3000, maxBuffer: 4096 },
    );
    return stdout.trim() === '';
  }
  private async read(path: string, maxBuffer = 32_768) {
    const { stdout } = await this.execute(['exec', this.options.name, 'cat', path], {
      timeout: 3000,
      maxBuffer,
    });
    return stdout;
  }
  async start() {
    const { name, volume, image, user } = this.options;
    if (
      !/^spinel-[a-z0-9-]+$/.test(name) ||
      !/^spinel-[a-z0-9-]+$/.test(volume) ||
      !/^sha256:[a-f0-9]{64}$/.test(image) ||
      !/^\d+:\d+$/.test(user)
    )
      throw new Error('Invalid observer identity.');
    this.attempted = true; // Uncertain launches still require physical containment.
    await this.execute(
      [
        'run',
        '-d',
        '--pull=never',
        '--name',
        name,
        '--network=none',
        '--read-only',
        '--memory=32m',
        '--memory-swap=32m',
        '--cpus=0.1',
        '--pids-limit=16',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--user',
        user,
        '--mount',
        `type=volume,src=${volume},dst=/state,readonly`,
        '--entrypoint=/bin/sh',
        image,
        '-c',
        idle,
      ],
      { timeout: 10_000, maxBuffer: 4096 },
    );
    const value = await this.inspect();
    if (!/^[a-f0-9]{64}$/.test(value.Id ?? ''))
      throw new Error('Invalid observer container identity.');
    this.ownedId = value.Id;
    const mount = value.Mounts?.find(
      (entry: { Destination?: unknown }) => entry.Destination === '/state',
    );
    if (
      value.Image !== image ||
      value.Config.User !== user ||
      JSON.stringify(value.Config.Entrypoint) !== JSON.stringify(['/bin/sh']) ||
      JSON.stringify(value.Config.Cmd) !== JSON.stringify(['-c', idle]) ||
      value.HostConfig.NetworkMode !== 'none' ||
      value.HostConfig.PidMode !== '' ||
      !value.HostConfig.ReadonlyRootfs ||
      value.HostConfig.Memory !== 32 * 1024 * 1024 ||
      value.HostConfig.MemorySwap !== 32 * 1024 * 1024 ||
      value.HostConfig.NanoCpus !== 100_000_000 ||
      value.HostConfig.PidsLimit !== 16 ||
      mount?.Name !== volume ||
      mount.RW !== false ||
      !value.State.Running ||
      !Number.isSafeInteger(value.State.Pid) ||
      value.State.Pid <= 0
    )
      throw new Error('Observer isolation profile differs from its fixed contract.');
    const { stdout } = await this.execute(['exec', name, 'readlink', '/proc/1/ns/pid'], {
      timeout: 3000,
      maxBuffer: 1024,
    });
    const pidNamespace = stdout.trim();
    if (!/^pid:\[\d+\]$/.test(pidNamespace)) throw new Error('Invalid observer PID namespace.');
    this.evidence.identity = {
      containerId: value.Id,
      name,
      image,
      user,
      hostPid: value.State.Pid,
      pidNamespace,
    };
    this.evidence.profile = {
      memoryBytes: 32 * 1024 * 1024,
      swapBytes: 0,
      cpus: 0.1,
      pids: 16,
      network: 'none',
      volumeReadOnly: true,
    };
    this.evidence.initialResources = await this.resources();
    return pidNamespace;
  }
  async jobs() {
    const { stdout } = await this.execute(
      ['exec', this.options.name, 'ls', '-1', '/state/recovery/restore-jobs'],
      {
        timeout: 3000,
        maxBuffer: 4096,
      },
    );
    return stdout.trim().split('\n').filter(Boolean);
  }
  journal() {
    return this.read('/state/recovery/journal.json');
  }
  job(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid observed job identity.');
    return this.read(`/state/recovery/restore-jobs/${id}/state.json`, 1024 * 1024);
  }
  private async resources() {
    const result: Record<string, number | string> = {};
    for (const key of [
      'memory.current',
      'memory.peak',
      'memory.max',
      'memory.swap.max',
      'cpu.max',
      'pids.max',
    ]) {
      const value = (await this.read(`/sys/fs/cgroup/${key}`, 1024)).trim();
      if (key === 'cpu.max') {
        if (!/^\d+ \d+$/.test(value)) throw new Error('Invalid observer CPU observation.');
        result[key] = value;
      } else {
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))
          throw new Error('Invalid observer resource observation.');
        result[key] = Number(value);
      }
    }
    return result;
  }
  close() {
    return (this.closed ??= this.closeOwned());
  }
  private async closeOwned() {
    if (!this.attempted) return true;
    try {
      let absentBefore: boolean | null = null;
      try {
        absentBefore = await this.absent();
      } catch {
        this.evidence.initialInventoryUnavailable = true;
      }
      if (absentBefore) {
        this.evidence.absenceConfirmed = true;
        return false; // A disappeared attempted observer has no confirmed final evidence.
      }
      // Only the fixed idle shell writes container logs; metadata cat/ls output
      // is returned directly to the caller and never included in this log stream.
      const logs = await this.execute(['logs', '--tail', '20', this.options.name], {
        timeout: 3000,
        maxBuffer: 4096,
      }).catch(() => null);
      this.evidence.logs = logs
        ? {
            stdoutBytes: Buffer.byteLength(logs.stdout),
            stderrBytes: Buffer.byteLength(logs.stderr),
            errorCode:
              /\b(EACCES|EPERM|ENOMEM|ENOSPC|EROFS|ENOENT)\b/.exec(
                `${logs.stdout}\n${logs.stderr}`,
              )?.[1] ?? null,
          }
        : null;
      this.evidence.finalResources = await this.resources().catch(() => null);
      const before = await this.inspect().catch(() => null);
      this.evidence.beforeClosure = closedState(before?.State);
      await this.execute(['stop', '--time', '1', this.ownedId ?? this.options.name], {
        timeout: 4000,
        maxBuffer: 4096,
      }).catch(() => {});
      let value = await this.inspect().catch(() => null);
      if (!closedState(value?.State) || value.State.Running || value.State.Pid !== 0) {
        await this.execute(['kill', this.ownedId ?? this.options.name], {
          timeout: 3000,
          maxBuffer: 4096,
        }).catch(() => {});
        await this.execute(['wait', this.ownedId ?? this.options.name], {
          timeout: 3000,
          maxBuffer: 4096,
        }).catch(() => {});
        value = await this.inspect().catch(() => null);
      }
      this.evidence.closure = closedState(value?.State);
      if (!closedState(value?.State) || value.State.Running || value.State.Pid !== 0) return false;
      await this.execute(['rm', this.ownedId ?? this.options.name], {
        timeout: 3000,
        maxBuffer: 4096,
      }).catch(() => {});
      const absent = await this.absent();
      this.evidence.absenceConfirmed = absent;
      return (
        absent &&
        value.State.ExitCode === 0 &&
        !value.State.OOMKilled &&
        this.evidence.finalResources !== null
      );
    } catch {
      return false;
    }
  }
}
