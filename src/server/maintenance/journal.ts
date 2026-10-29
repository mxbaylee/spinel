import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { MaintenanceNotice, MaintenancePhase } from '../../shared/maintenance.ts';
import { assertNoPendingRestore } from './restore-barrier.ts';
import { validRestoreStopRecord } from './restore-stop.ts';
import type { RestoreStopRecord } from './restore-stop.ts';
import { RestoreJobs } from './restore-jobs.ts';

const MAX_JOURNAL_BYTES = 32_768;
export const AUTHORITY_MS = 5 * 60_000;
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[0-9a-f]{64}$/;
const phases: MaintenancePhase[] = [
  'running',
  'draining',
  'paused',
  'stopping',
  'stopped',
  'starting',
  'recovery-required',
];
export interface FileIdentity {
  device: string;
  inode: string;
}
export interface ProcessIdentity {
  pid: number;
  start: string;
  boot: string;
  token: string;
}
export interface OperationReceipt {
  id: string;
  intentHash: string;
  expiresAt: number;
}
export interface RecoveryOperation {
  id: string;
  actorId: string;
  sessionHash: string;
  tokenHash: string;
  expiresAt: number;
  generationId: string;
}
export interface RecoveryJournalState {
  version: 1;
  instanceId: string;
  generationId: string;
  databasePath: string;
  databaseIdentity: FileIdentity | null;
  epoch: string;
  phase: MaintenancePhase;
  operation: RecoveryOperation | null;
  completedOperationId: string | null;
  receipts: OperationReceipt[];
  notice: MaintenanceNotice | null;
  child: ProcessIdentity | null;
  verifier: ProcessIdentity | null;
  verifiedAt: number | null;
  lastFailure: string | null;
  updatedAt: number;
  /** Historical binding survives supervisor epoch changes. Older journals omit it. */
  restoreStop?: RestoreStopRecord | null;
  /** Only identity lives here; the separate job owns its restore checkpoint. */
  restoreJob?: { jobId: string; intentHash: string } | null;
}

export function maintenanceSupported() {
  if (process.platform !== 'linux' || !process.getuid)
    throw new Error('Supervised maintenance requires Linux and its local filesystem profile.');
}

export function canonicalDatabasePath(path: string) {
  let ancestor = resolve(path);
  const missing: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(ancestor), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      // An offline import leases its future filename before creating the target
      // directory. Resolve its nearest existing ancestor without creating it.
      // A dangling link must never redirect that lease on later creation.
      try {
        if (lstatSync(ancestor).isSymbolicLink())
          throw new Error('Workspace symlink target is missing.');
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure;
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      missing.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

function lockName(kind: string, identity: string) {
  return `\0spinel-${kind}-${createHash('sha256').update(identity).digest('hex')}`;
}
export class WorkspaceLeaseBusyError extends Error {
  constructor(kind: string, cause: unknown) {
    super(
      kind.startsWith('application')
        ? 'This workspace already has an active application or supervisor.'
        : 'This workspace already has an active supervisor or offline operation.',
      { cause },
    );
    this.name = 'WorkspaceLeaseBusyError';
  }
}
async function kernelLock(kind: string, identity: string): Promise<Server> {
  maintenanceSupported();
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(lockName(kind, identity), () => {
      server.removeListener('error', reject);
      // A lease must survive while its process lives, but must not keep a failed
      // CLI or a closed app alive. The kernel releases it at process exit.
      server.unref();
      resolveListen();
    });
  }).catch((error) => {
    server.close();
    if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE')
      throw new WorkspaceLeaseBusyError(kind, error);
    throw error;
  });
  return server;
}
function releaseLock(server: Server) {
  return new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose())),
  );
}

export interface WorkspaceLease {
  /** The path selected before ownership was acquired. */
  path: string;
  /** Bind a newly created file before any application database is opened. */
  bindFile(): Promise<void>;
  /** Share the already-bound kernel ownership, never a replacement listener. */
  handles(): readonly [Server, Server];
  release(): Promise<void>;
}
export const workspaceOwnershipRoles = [
  'workspace',
  'workspace-file',
  'application',
  'application-file',
] as const;
export type WorkspaceOwnershipRole = (typeof workspaceOwnershipRoles)[number];
export interface WorkspaceOwnership {
  databasePath: string;
  databaseIdentity: FileIdentity;
  handles: Record<WorkspaceOwnershipRole, Server>;
}
export function workspaceOwnershipAddresses(databasePath: string, identity: FileIdentity) {
  return Object.fromEntries(
    workspaceOwnershipRoles.map((role) => [
      role,
      lockName(
        role,
        role.endsWith('-file') ? `${identity.device}:${identity.inode}` : databasePath,
      ),
    ]),
  ) as Record<WorkspaceOwnershipRole, string>;
}
// One-shot CLI and direct-app leases intentionally survive their JS call frame.
// Pin the unref'd servers until explicit pre-open/test cleanup or process exit.
const heldWorkspaceLeases = new Set<WorkspaceLease>();

async function acquireWorkspaceLease(
  databasePath: string,
  kind: 'workspace' | 'application',
  supervised = false,
) {
  const canonical = canonicalDatabasePath(databasePath);
  if (!supervised) assertNoPendingRestore(canonical);
  const pathLock = await kernelLock(kind, canonical);
  let fileLock: Server | undefined;
  let boundIdentity: FileIdentity | undefined;
  let released = false;
  const bindFile = async (required: boolean) => {
    if (released) throw new Error('Workspace ownership has already been released.');
    if (!supervised) assertNoPendingRestore(canonical);
    let identity: FileIdentity;
    try {
      identity = fileIdentity(canonical);
    } catch (error) {
      if (!required && !fileLock && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (fileLock) {
      if (!sameFile(boundIdentity ?? null, identity))
        throw new Error('Workspace changed while ownership was held.');
      return;
    }
    fileLock = await kernelLock(`${kind}-file`, `${identity.device}:${identity.inode}`);
    if (!sameFile(identity, fileIdentity(canonical)))
      throw new Error('Workspace changed while acquiring control.');
    boundIdentity = identity;
  };
  const release = async () => {
    if (released) return;
    released = true;
    heldWorkspaceLeases.delete(lease);
    const results = await Promise.allSettled([
      releaseLock(pathLock),
      ...(fileLock ? [releaseLock(fileLock)] : []),
    ]);
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  };
  const lease = {
    path: canonical,
    bindFile: () => bindFile(true),
    handles: () => {
      if (released || !fileLock || !sameFile(boundIdentity ?? null, fileIdentity(canonical)))
        throw new Error('Workspace ownership is not bound to the current file.');
      return [pathLock, fileLock] as const;
    },
    release,
  } satisfies WorkspaceLease;
  heldWorkspaceLeases.add(lease);
  try {
    await bindFile(false);
  } catch (error) {
    await release().catch(() => {});
    throw error;
  }
  return lease;
}

/** Hold this lease across the complete standalone CLI database lifetime.
 * Linux releases the abstract socket on process death; no stale lock can be stolen.
 */
export async function acquireColdWorkspace(databasePath: string) {
  return (await acquireColdWorkspaceLease(databasePath)).release;
}

/** Startup additionally binds the inode after creating its initial empty file. */
export function acquireColdWorkspaceLease(databasePath: string) {
  return acquireWorkspaceLease(databasePath, 'workspace');
}

export interface ColdWorkspaceFiles {
  /** Bind every new file before SQLite opens it; retain earlier inode ownership. */
  bindFile(path: string): Promise<void>;
  /** Only before any database open, or after a disposable test process exits. */
  release(): Promise<void>;
}
const heldColdWorkspaceFiles = new Set<ColdWorkspaceFiles>();

/** Offline transitions replace staging files and rename them into reserved paths.
 * Keep every possibly live inode until process exit, sharing a listener only after
 * its old reserved pathname no longer identifies it. Concurrent source/target
 * aliases remain forbidden: a writable copy must never alias its retained source.
 */
export async function acquireColdWorkspaceFiles(
  paths: readonly string[],
): Promise<ColdWorkspaceFiles> {
  const canonical = paths.map(canonicalDatabasePath).sort();
  if (!canonical.length || new Set(canonical).size !== canonical.length)
    throw new Error('Cold workspace paths must be distinct.');
  const pathLocks = new Map<string, Server>();
  const fileLocks = new Map<string, Server>();
  const boundPaths = new Map<string, FileIdentity>();
  let released = false;
  const bindFile = async (path: string, required: boolean) => {
    if (released) throw new Error('Workspace ownership has already been released.');
    const selected = canonicalDatabasePath(path);
    if (!pathLocks.has(selected)) throw new Error('Workspace path was not reserved.');
    assertNoPendingRestore(selected);
    let identity: FileIdentity;
    try {
      identity = fileIdentity(selected);
    } catch (error) {
      if (!required && (error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const [other, previous] of boundPaths) {
      if (other === selected || !sameFile(previous, identity)) continue;
      try {
        if (sameFile(identity, fileIdentity(other)))
          throw new Error('Cold workspace source and target files must not alias.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    const key = `${identity.device}:${identity.inode}`;
    if (!fileLocks.has(key)) fileLocks.set(key, await kernelLock('workspace-file', key));
    if (!sameFile(identity, fileIdentity(selected)))
      throw new Error('Workspace changed while acquiring control.');
    boundPaths.set(selected, identity);
  };
  const lease: ColdWorkspaceFiles = {
    bindFile: (path) => bindFile(path, true),
    async release() {
      if (released) return;
      released = true;
      heldColdWorkspaceFiles.delete(lease);
      const results = await Promise.allSettled(
        [...pathLocks.values(), ...fileLocks.values()].map(releaseLock),
      );
      const failed = results.find((result) => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
    },
  };
  heldColdWorkspaceFiles.add(lease);
  try {
    for (const path of canonical) pathLocks.set(path, await kernelLock('workspace', path));
    for (const path of canonical) await bindFile(path, false);
  } catch (error) {
    await lease.release().catch(() => {});
    throw error;
  }
  return lease;
}

/** Separate app ownership permits legacy cold CLI operations beside a direct app.
 * Keep it until process exit after any DB open: native handles may outlive close().
 * Abstract sockets coordinate only within one Linux network namespace.
 */
export function acquireLiveWorkspace(databasePath: string) {
  return acquireWorkspaceLease(databasePath, 'application');
}

export function fileIdentity(path: string): FileIdentity {
  if (realpathSync(path) !== resolve(path))
    throw new Error('Workspace path must not be a symlink.');
  const info = lstatSync(path, { bigint: true });
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Workspace is not a regular file.');
  return { device: String(info.dev), inode: String(info.ino) };
}
export function sameFile(a: FileIdentity | null, b: FileIdentity | null) {
  return !!a && !!b && a.device === b.device && a.inode === b.inode;
}
export function processIdentity(pid: number, token = ''): ProcessIdentity | null {
  try {
    const fields = readFileSync(`/proc/${pid}/stat`, 'utf8')
      .replace(/^.*\) /, '')
      .split(' ');
    if (fields[0] === 'Z' || fields[0] === 'X') return null;
    return {
      pid,
      start: fields[19],
      boot: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
      token,
    };
  } catch (error) {
    if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) return null;
    throw error;
  }
}
export function sameProcess(identity: ProcessIdentity | null) {
  if (!identity) return false;
  const current = processIdentity(identity.pid);
  return current?.start === identity.start && current.boot === identity.boot;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function identity(value: unknown): value is FileIdentity {
  return (
    record(value) &&
    typeof value.device === 'string' &&
    /^\d+$/.test(value.device) &&
    typeof value.inode === 'string' &&
    /^\d+$/.test(value.inode)
  );
}
export function validNotice(value: unknown): value is MaintenanceNotice {
  if (
    !record(value) ||
    typeof value.id !== 'string' ||
    !uuidPattern.test(value.id) ||
    !Number.isSafeInteger(value.startsAt) ||
    Number(value.startsAt) <= 0 ||
    !Number.isInteger(value.durationMinutes) ||
    Number(value.durationMinutes) < 1 ||
    Number(value.durationMinutes) > 24 * 60 ||
    typeof value.timeZone !== 'string' ||
    value.timeZone.length > 100 ||
    !/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)+)$/.test(value.timeZone) ||
    !['scheduled', 'started', 'cancelled', 'missed'].includes(String(value.state))
  )
    return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.timeZone }).format();
  } catch {
    return false;
  }
  return true;
}
function validState(value: unknown, databasePath: string): value is RecoveryJournalState {
  if (
    !record(value) ||
    value.version !== 1 ||
    value.databasePath !== databasePath ||
    ![value.instanceId, value.generationId, value.epoch].every(
      (id) => typeof id === 'string' && uuidPattern.test(id),
    ) ||
    !phases.includes(value.phase as MaintenancePhase) ||
    !(value.databaseIdentity === null || identity(value.databaseIdentity)) ||
    !(value.notice === null || validNotice(value.notice)) ||
    !(
      value.completedOperationId === null ||
      (typeof value.completedOperationId === 'string' &&
        uuidPattern.test(value.completedOperationId))
    ) ||
    !(
      value.verifiedAt === null ||
      (Number.isSafeInteger(value.verifiedAt) && Number(value.verifiedAt) > 0)
    ) ||
    !(
      value.lastFailure === null ||
      (typeof value.lastFailure === 'string' && /^[a-z-]{1,64}$/.test(value.lastFailure))
    ) ||
    !Number.isSafeInteger(value.updatedAt) ||
    !(
      value.restoreStop === undefined ||
      value.restoreStop === null ||
      validRestoreStopRecord(value.restoreStop)
    ) ||
    !(
      value.restoreJob === undefined ||
      value.restoreJob === null ||
      (record(value.restoreJob) &&
        Object.keys(value.restoreJob).length === 2 &&
        typeof value.restoreJob.jobId === 'string' &&
        uuidPattern.test(value.restoreJob.jobId) &&
        typeof value.restoreJob.intentHash === 'string' &&
        hashPattern.test(value.restoreJob.intentHash))
    ) ||
    !Array.isArray(value.receipts) ||
    value.receipts.length > 128 ||
    !value.receipts.every(
      (receipt) =>
        record(receipt) &&
        typeof receipt.id === 'string' &&
        uuidPattern.test(receipt.id) &&
        typeof receipt.intentHash === 'string' &&
        hashPattern.test(receipt.intentHash) &&
        Number.isSafeInteger(receipt.expiresAt),
    )
  )
    return false;
  for (const child of [value.child, value.verifier])
    if (
      child !== null &&
      (!record(child) ||
        !Number.isInteger(child.pid) ||
        Number(child.pid) <= 1 ||
        typeof child.start !== 'string' ||
        !/^\d+$/.test(child.start) ||
        typeof child.boot !== 'string' ||
        !uuidPattern.test(child.boot) ||
        typeof child.token !== 'string' ||
        !uuidPattern.test(child.token))
    )
      return false;
  if (
    value.operation !== null &&
    (!record(value.operation) ||
      typeof value.operation.id !== 'string' ||
      !uuidPattern.test(value.operation.id) ||
      typeof value.operation.generationId !== 'string' ||
      value.operation.generationId !== value.generationId ||
      typeof value.operation.actorId !== 'string' ||
      value.operation.actorId.length > 128 ||
      typeof value.operation.sessionHash !== 'string' ||
      !hashPattern.test(value.operation.sessionHash) ||
      typeof value.operation.tokenHash !== 'string' ||
      !hashPattern.test(value.operation.tokenHash) ||
      !Number.isSafeInteger(value.operation.expiresAt))
  )
    return false;
  return true;
}

/** A small, private, fsync'd replacement journal outside every archived database.
 * The descriptor pins the configured root, and a kernel lock owns all replacements.
 */
export class RecoveryJournal {
  readonly root: string;
  readonly databasePath: string;
  state: RecoveryJournalState;
  readonly wasUnverified: boolean;
  private readonly handle: number;
  private readonly rootIdentity: FileIdentity;
  private readonly rootLock: Server;
  private coldWorkspace: WorkspaceLease | undefined;
  private liveWorkspace: WorkspaceLease | undefined;
  private corrupted = false;
  private closed = false;

  private constructor(root: string, databasePath: string, handle: number, rootLock: Server) {
    this.root = root;
    this.databasePath = databasePath;
    this.handle = handle;
    this.rootLock = rootLock;
    const info = fstatSync(handle, { bigint: true });
    this.rootIdentity = { device: String(info.dev), inode: String(info.ino) };
    let loaded: unknown;
    try {
      const descriptor = openSync(
        this.path('journal.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const metadata = fstatSync(descriptor);
        if (
          !metadata.isFile() ||
          metadata.uid !== process.getuid!() ||
          metadata.mode & 0o077 ||
          metadata.size > MAX_JOURNAL_BYTES
        )
          throw new Error('Invalid recovery journal.');
        loaded = JSON.parse(readFileSync(descriptor, 'utf8'));
      } finally {
        closeSync(descriptor);
      }
      if (!validState(loaded, databasePath)) throw new Error('Invalid recovery journal.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.corrupted = true;
      loaded = undefined;
    }
    this.cleanPending();
    this.wasUnverified = !loaded;
    this.state = (loaded as RecoveryJournalState) ?? {
      version: 1,
      instanceId: randomUUID(),
      generationId: randomUUID(),
      databasePath,
      databaseIdentity: null,
      epoch: randomUUID(),
      phase: 'recovery-required',
      operation: null,
      completedOperationId: null,
      receipts: [],
      notice: null,
      child: null,
      verifier: null,
      verifiedAt: null,
      lastFailure: this.corrupted ? 'journal-invalid' : 'generation-unverified',
      updatedAt: Date.now(),
      restoreStop: null,
      restoreJob: null,
    };
    if (!loaded && !this.corrupted) this.write();
  }

  static async open(root: string, databasePath: string) {
    maintenanceSupported();
    const canonical = canonicalDatabasePath(databasePath);
    if (!isAbsolute(root) || root === '/' || resolve(root) !== root || realpathSync(root) !== root)
      throw new Error('Use an existing canonical absolute recovery directory.');
    const dataDirectory = dirname(canonical);
    if (root === dataDirectory || root.startsWith(dataDirectory + sep))
      throw new Error('Recovery control must be outside the workspace and diagnostics directory.');
    const handle = openSync(
      root,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    let rootLock: Server | undefined;
    try {
      const info = fstatSync(handle);
      if (!info.isDirectory() || info.uid !== process.getuid!() || info.mode & 0o077)
        throw new Error('Recovery directory must be owned by this user and private (0700).');
      rootLock = await kernelLock('recovery', `${info.dev}:${info.ino}`);
      // Recorded orphan processes inherit both dataset leases. Read their
      // identities under root-only ownership, then reconcile them before trying
      // to acquire those leases. No database/control command is admitted yet.
      return new RecoveryJournal(root, canonical, handle, rootLock);
    } catch (error) {
      await Promise.allSettled([
        Promise.resolve().then(() => closeSync(handle)),
        ...(rootLock ? [releaseLock(rootLock)] : []),
      ]);
      throw error;
    }
  }

  private cleanPending() {
    const names = readdirSync(`/proc/self/fd/${this.handle}`);
    if (names.length > 256) throw new Error('Recovery directory exceeds its bounded inventory.');
    for (const name of names) {
      if (!/^pending-[0-9a-f-]{36}$/.test(name) || !uuidPattern.test(name.slice(8))) continue;
      const path = this.path(name as `pending-${string}`);
      const info = lstatSync(path);
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.uid !== process.getuid!() ||
        info.mode & 0o077 ||
        info.size > MAX_JOURNAL_BYTES
      )
        throw new Error('Invalid interrupted recovery journal.');
      unlinkSync(path);
    }
    fsyncSync(this.handle);
  }
  path(
    name:
      | 'journal.json'
      | 'control.sock'
      | 'restore-jobs'
      | `pending-${string}`
      | `rejected-${string}.json`,
  ) {
    return `/proc/self/fd/${this.handle}/${name}`;
  }
  syncRoot() {
    this.checkRoot();
    fsyncSync(this.handle);
    this.checkRoot();
  }
  async bindWorkspace() {
    this.checkRoot();
    if (!this.coldWorkspace || !this.liveWorkspace) {
      // Only the supervisor may own an interrupted target for protective rollback.
      // Its verify/start/resume paths separately refuse unresolved restore evidence.
      const cold = await acquireWorkspaceLease(this.databasePath, 'workspace', true);
      let live: WorkspaceLease | undefined;
      try {
        live = await acquireWorkspaceLease(this.databasePath, 'application', true);
        await cold.bindFile();
        await live.bindFile();
        this.coldWorkspace = cold;
        this.liveWorkspace = live;
      } catch (error) {
        await Promise.allSettled([cold.release(), ...(live ? [live.release()] : [])]);
        throw error;
      }
    } else {
      await this.coldWorkspace.bindFile();
      await this.liveWorkspace.bindFile();
    }
  }
  workspaceOwnership(): WorkspaceOwnership {
    this.checkRoot();
    if (!this.coldWorkspace || !this.liveWorkspace)
      throw new Error('Workspace ownership has not been acquired.');
    const [coldPath, coldFile] = this.coldWorkspace.handles();
    const [livePath, liveFile] = this.liveWorkspace.handles();
    return {
      databasePath: this.databasePath,
      databaseIdentity: fileIdentity(this.databasePath),
      handles: {
        workspace: coldPath,
        'workspace-file': coldFile,
        application: livePath,
        'application-file': liveFile,
      },
    };
  }
  checkRoot() {
    const current = lstatSync(this.root, { bigint: true });
    if (
      this.closed ||
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      realpathSync(this.root) !== this.root ||
      current.uid !== BigInt(process.getuid!()) ||
      current.mode & 0o077n ||
      !sameFile(this.rootIdentity, { device: String(current.dev), inode: String(current.ino) })
    )
      throw new Error('Recovery directory is missing or changed.');
  }
  /** Metadata-only admissions are still unfinished work. Missing/corrupt main
   * state must not let cold verification silently discard independent records.
   * Later restore-stage reconciliation will replace this conservative refusal.
   */
  assertNoPendingRestoreJobs() {
    this.checkRoot();
    let jobs: RestoreJobs | undefined;
    try {
      try {
        lstatSync(this.path('restore-jobs'));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !this.state.restoreJob) return;
        throw error;
      }
      jobs = new RestoreJobs(this);
      const records = jobs.list();
      if (this.state.restoreJob || records.some((record) => record.phase !== 'failed'))
        throw new Error('Unreconciled restore admission.');
    } catch (error) {
      throw new Error('An unfinished restore job requires supervised recovery before continuing.', {
        cause: error,
      });
    } finally {
      jobs?.close();
    }
  }
  /** Only explicit cold-host verification may replace an unreadable journal. */
  acceptJournal() {
    this.checkRoot();
    assertNoPendingRestore(this.databasePath);
    this.assertNoPendingRestoreJobs();
    if (this.corrupted) {
      const info = lstatSync(this.path('journal.json'));
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.uid !== process.getuid!() ||
        info.mode & 0o077
      )
        throw new Error(
          'Invalid journal type or permissions need explicit cold-host filesystem repair.',
        );
      const name = `rejected-${randomUUID()}.json` as const;
      renameSync(this.path('journal.json'), this.path(name));
      fsyncSync(this.handle);
      this.corrupted = false;
    }
  }
  write() {
    this.checkRoot();
    if (this.corrupted)
      throw new Error('An invalid recovery journal needs cold-host verification.');
    const text = JSON.stringify(this.state) + '\n';
    if (Buffer.byteLength(text) > MAX_JOURNAL_BYTES)
      throw new Error('Recovery journal exceeds its storage budget.');
    const name = `pending-${randomUUID()}` as const;
    const file = this.path(name);
    let descriptor: number | undefined;
    let failure: unknown;
    try {
      descriptor = openSync(
        file,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      writeFileSync(descriptor, text);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      this.checkRoot();
      renameSync(file, this.path('journal.json'));
      fsyncSync(this.handle);
      this.checkRoot();
    } catch (error) {
      failure = error;
    }
    try {
      if (descriptor !== undefined) closeSync(descriptor);
    } catch (error) {
      failure ??= error;
    }
    try {
      unlinkSync(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failure ??= error;
    }
    if (failure) throw failure;
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    let failure: unknown;
    try {
      closeSync(this.handle);
    } catch (error) {
      failure = error;
    }
    const releases = await Promise.allSettled([
      releaseLock(this.rootLock),
      ...(this.coldWorkspace ? [this.coldWorkspace.release()] : []),
      ...(this.liveWorkspace ? [this.liveWorkspace.release()] : []),
    ]);
    for (const result of releases) if (result.status === 'rejected') failure ??= result.reason;
    if (failure) throw failure;
  }
}
