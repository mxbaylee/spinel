import { restoreExecutionFailureReason } from './restore-failure.ts';
import { isDeepStrictEqual } from 'node:util';
import { estimateRestoreCapacity, validRestorePreviewBytes } from './restore-capacity.ts';
import type { RestoreCapacityVolume } from './restore-capacity.ts';
import { RecoveryResourceError } from '../backup/resource-error.ts';
import { prepareAndActivateRestoreOriginal } from './restore-original.ts';
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import type { IncomingMessage, ServerResponse, Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  MaintenanceAdminStatus,
  MaintenanceAuthority,
  MaintenanceControlResult,
  RestoreAuthority,
  RestoreStopRequest,
} from '../../shared/maintenance.ts';
import { publicMaintenance } from '../../shared/maintenance.ts';
import { validRestorePreview } from '../../shared/restore.ts';
import type { RestorePreview } from '../../shared/restore.ts';
import {
  AUTHORITY_MS,
  RecoveryJournal,
  WorkspaceLeaseBusyError,
  fileIdentity,
  processIdentity,
  sameFile,
  uuidPattern,
  validNotice,
} from './journal.ts';
import type { OperationReceipt, ProcessIdentity, RecoveryJournalState } from './journal.ts';
import { MAINTENANCE_CHANNEL } from './supervisor-client.ts';
import { boundedRestoreRpc, RESTORE_RPC_ERROR, RESTORE_RPC_PENDING } from './restore-rpc.ts';
import type { RestoreRpcAction } from './restore-rpc.ts';
import type {
  RestoreCapacityRequest,
  RestoreCapacityResult,
  RestoreObservation,
} from '../backup/restore-control.ts';
import { shareWorkspaceOwnership } from './ownership.ts';
import { processResourcesReleased, waitForProcessInventory } from './process-exit.ts';
import { assertNoPendingRestore } from './restore-barrier.ts';
import {
  sameRestoreStopRequest,
  validRestoreFingerprint,
  validRestoreStopRequest,
} from './restore-stop.ts';
import type { RestoreStopRecord } from './restore-stop.ts';
import { checkVerificationHeadroom } from '../backup/recovery-worker.ts';
import { RestoreJobs, isCommittedRestoreJob, selectedRestoreTrial } from './restore-jobs.ts';
import type { RestoreJobRecord } from './restore-jobs.ts';
import { restoreIntentHash } from './restore-job-intent.ts';
import type { RestoreJobIntent } from './restore-job-intent.ts';
import {
  retainRestoreSource,
  readRetainedRestoreSource,
  validRestoreSourceManifest,
  captureRestoreOriginals,
  preserveRestoreOriginals,
  commitRestoreFiles,
} from './restore-files.ts';
import type { RestoreSourceInput, RestoreSourceManifest } from './restore-files.ts';
import { validRestoreAuthority } from './restore-authority.ts';
import type { ApplicationPolicy } from '../../../server/application-policy.ts';
import { freezeCurrentRestore } from '../backup/restore-freeze.ts';
import { prepareRestoreAttempt } from './restore-prepare.ts';
import { activateRestoreAttempt } from './restore-activate.ts';
import { restoreTrialReference, sameRestoreTrialReference } from './restore-trial.ts';
import type { RestoreTrialPermit } from './restore-trial.ts';
import {
  RESTORE_TRIAL_STOP_MS,
  sameRestoreTrialStopRequest,
  validRestoreTrialStopRequest,
} from './restore-trial-stop.ts';
import type { RestoreTrialStopRequest } from './restore-trial-stop.ts';
import { syncRestoreDirectory } from '../backup/restore-input.ts';
import {
  captureFailedRestoreCustody,
  preserveFailedRestoreCustody,
  failedRestoreCustodyInputs,
} from './restore-failed-custody.ts';

/** Only this pre-publication planner refusal may carry resource advice over IPC. */
class RestoreBeginCapacityError extends RecoveryResourceError {
  readonly jobId: string;
  #intentHash: string;
  #revision: number;
  #child: ProcessIdentity;
  constructor(record: RestoreJobRecord, child: ProcessIdentity) {
    super('disk-space');
    this.jobId = record.intent.id;
    this.#intentHash = record.intentHash;
    this.#revision = record.revision;
    this.#child = structuredClone(child);
  }
  matches(record: RestoreJobRecord, child: ProcessIdentity | null) {
    return (
      record.intentHash === this.#intentHash &&
      record.revision === this.#revision &&
      isDeepStrictEqual(child, this.#child)
    );
  }
}

const DRAIN_MS = 30_000;
const STOP_MS = 15_000;
const START_MS = 30_000;
const VERIFY_MS = 15_000;
const safeError =
  'Maintenance could not complete this operation. Check its current status with the recovery CLI.';
const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');

export type ColdMaintenanceCommand =
  | { action: 'status' }
  | { action: 'pause' | 'stop' | 'start' | 'verify' | 'resume'; operationId: string };

/** Only the trusted app-owned prepared-source registry constructs this private
 * descriptor. HTTP callers never select filesystem paths or authority records. */
export interface RestoreAdmission {
  id: string;
  generationId: string;
  epoch: string;
  authority: RestoreAuthority;
  confirmedAt: number;
  preview: RestorePreview;
  previewDatabaseBytes: number;
  consequenceEnvelope: 1;
  source: RestoreSourceInput;
}
interface SupervisorOptions {
  root: string;
  databasePath: string;
  publicPort?: number;
  development?: boolean;
  /** Deployment-owned snapshot; omission leaves restore admission unavailable. */
  applicationPolicy?: ApplicationPolicy;
  /** Test seams select real disposable processes; never supplied over a control API. */
  createChild?: (groupToken: string, environment: NodeJS.ProcessEnv) => ChildProcess;
  now?: () => number;
  /** Test-only per-volume disk observation; never accepted by a control request. */
  restoreCapacityVolume?: RestoreCapacityVolume;
  budgets?: {
    drainMs?: number;
    stopMs?: number;
    startMs?: number;
    verifyMs?: number;
    restoreMs?: number;
  };
  onTransition?: (status: MaintenanceAdminStatus) => void;
}
interface Waiter {
  resolve: () => void;
  reject: (error: Error) => void;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}
function operationId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !uuidPattern.test(value))
    throw new Error('Use a valid operation ID.');
}
function authority(value: unknown, now: number): asserts value is MaintenanceAuthority {
  if (
    !object(value) ||
    !exact(value, ['actorId', 'sessionHash', 'expiresAt']) ||
    typeof value.actorId !== 'string' ||
    !uuidPattern.test(value.actorId) ||
    typeof value.sessionHash !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.sessionHash) ||
    !Number.isSafeInteger(value.expiresAt) ||
    Number(value.expiresAt) <= now ||
    Number(value.expiresAt) > now + AUTHORITY_MS
  )
    throw new Error('Verify your current Operator passkey again.');
}
/**
 * The application never needs the recovery root, so it does not learn where
 * the journal and control socket live. This is not isolation: the child runs
 * as the same UID and can still find the directory, which is why the supported
 * deployment treats a compromised application process as out of scope.
 */
function childEnvironment() {
  const environment = { ...process.env };
  delete environment.SPINEL_MAINTENANCE_ROOT;
  return environment;
}
function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
function listening(server: HttpServer, options: { port: number; host: string } | { path: string }) {
  return new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(options, () => {
      server.removeListener('error', reject);
      resolveListen();
    });
  });
}
async function closeServer(server: HttpServer | undefined) {
  if (!server?.listening) return;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
    server.closeAllConnections();
  });
}

/** Only processes from a supervisor-created detached session can be signalled. */
function groupMembers(identity: ProcessIdentity) {
  if (identity.boot !== readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()) return [];
  const leader = processIdentity(identity.pid);
  if (leader && (leader.start !== identity.start || leader.boot !== identity.boot))
    throw new Error('Process leader identity changed.');
  const entries = readdirSync('/proc').filter((name) => /^\d+$/.test(name));
  if (entries.length > 32_768) throw new Error('Process inventory exceeds the recovery budget.');
  const members: number[] = [];
  for (const name of entries) {
    try {
      const path = `/proc/${name}`;
      const info = statSync(path);
      if (info.uid !== process.getuid!()) continue;
      const fields = readFileSync(`${path}/stat`, 'utf8')
        .replace(/^.*\) /, '')
        .split(' ');
      if ((fields[0] === 'Z' || fields[0] === 'X') && processResourcesReleased(name)) continue;
      if (Number(fields[2]) !== identity.pid) continue;
      if (Number(fields[3]) !== identity.pid || BigInt(fields[19]) < BigInt(identity.start))
        throw new Error('Process group identity changed.');
      const environment = readFileSync(`${path}/environ`, 'utf8');
      if (
        environment.length > 131_072 ||
        !`\0${environment}\0`.includes(`\0SPINEL_PROCESS_GROUP_TOKEN=${identity.token}\0`)
      )
        throw new Error('Process group ownership marker is missing or changed.');
      members.push(Number(name));
    } catch (error) {
      if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) continue;
      // Exit may revoke /proc access before the parent reaps the process.
      // A dead leader with surviving threads is not proof of closed resources.
      if ((error as NodeJS.ErrnoException).code === 'EACCES' && processResourcesReleased(name))
        continue;
      throw error;
    }
  }
  return members;
}

class WorkspaceHandlesOpenError extends Error {
  constructor() {
    super('A workspace or WAL handle is still open.');
  }
}

/** Never kills unrelated handle owners; their existence prevents a closed result. */
export function assertWorkspaceHandlesClosed(databasePath: string, ignored = new Set<number>()) {
  const targets = new Set([databasePath, `${databasePath}-wal`, `${databasePath}-shm`]);
  const identities = new Set<string>();
  for (const target of targets) {
    try {
      const info = lstatSync(target, { bigint: true });
      identities.add(`${info.dev}:${info.ino}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const entries = readdirSync('/proc').filter((name) => /^\d+$/.test(name));
  if (entries.length > 32_768) throw new Error('Process inventory exceeds the recovery budget.');
  for (const name of entries) {
    if (ignored.has(Number(name))) continue;
    try {
      if (statSync(`/proc/${name}`).uid !== process.getuid!()) continue;
      const descriptors = readdirSync(`/proc/${name}/fd`);
      if (descriptors.length > 4096)
        throw new Error('Handle inventory exceeds the recovery budget.');
      for (const descriptor of descriptors) {
        try {
          const path = `/proc/${name}/fd/${descriptor}`;
          const target = readlinkSync(path).replace(/ \(deleted\)$/, '');
          if (targets.has(target)) throw new WorkspaceHandlesOpenError();
          const info = statSync(path, { bigint: true });
          if (identities.has(`${info.dev}:${info.ino}`)) throw new WorkspaceHandlesOpenError();
        } catch (error) {
          if (['ENOENT', 'ESRCH', 'EINVAL'].includes((error as NodeJS.ErrnoException).code ?? ''))
            continue;
          throw error;
        }
      }
    } catch (error) {
      if (['ENOENT', 'ESRCH'].includes((error as NodeJS.ErrnoException).code ?? '')) continue;
      // Exit may revoke /proc access before the parent reaps the process.
      // A dead leader with surviving threads is not proof of closed resources.
      if ((error as NodeJS.ErrnoException).code === 'EACCES' && processResourcesReleased(name))
        continue;
      throw error;
    }
  }
}

/** Only a fully acknowledged evidence step may begin the one recovery attempt.
 * Reading a durable output after its publication threw is not an automatic retry. */
class WitnessedRestoreTrialFailure extends Error {
  readonly record: RestoreJobRecord;
  constructor(cause: unknown, record: RestoreJobRecord) {
    super('Restore trial failed after its final evidence was retained.', { cause });
    this.record = record;
  }
}
export class MaintenanceSupervisor {
  readonly journal: RecoveryJournal;
  private readonly options: SupervisorOptions;
  private readonly now: () => number;
  private readonly applicationPolicy: Readonly<ApplicationPolicy> | undefined;
  private child: ChildProcess | undefined;
  private childReady = false;
  private childChannelFailed = false;
  private childOwned = false;
  private childReadyEpoch: string | undefined;
  private drainWaiter: Waiter | undefined;
  private startWaiter: Waiter | undefined;
  private restoreWaiter:
    { resolve(record: RestoreStopRecord): void; reject(error: Error): void } | undefined;
  private restoreWitnessCheckpoint: ((record: RestoreStopRecord) => void) | undefined;
  private restoreExecution: Promise<void> | undefined;
  private restoreTrialWaiter:
    (Waiter & { permit: RestoreTrialPermit; assertCurrent(): void }) | undefined;
  private restoreTrialStopWaiter:
    | (Waiter & {
        stop: RestoreTrialStopRequest;
        accepted: boolean;
        fingerprint?: string;
        assertCurrent(): void;
        accept(fingerprint: string): void;
      })
    | undefined;
  private authorityWaiter:
    | {
        request: RestoreStopRequest;
        accept(): void;
        reject(error: Error): void;
      }
    | undefined;
  private restoreReleaseWaiter:
    (Waiter & { permit: RestoreTrialPermit; assertCurrent(): void }) | undefined;
  private restoreContinuation: { id: string; intentHash: string; token: string } | undefined;
  private restoreRpcRequests = new Map<string, RestoreRpcAction>();
  private restoreAdmissions = 0;
  private restoreAdmissionAbort: AbortController | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private publicServer: HttpServer | undefined;
  private controlServer: HttpServer | undefined;
  private noticeTimer: ReturnType<typeof setInterval> | undefined;
  private closing = false;
  private closingTask: Promise<void> | undefined;
  private constructor(journal: RecoveryJournal, options: SupervisorOptions) {
    this.journal = journal;
    this.options = options;
    this.now = options.now ?? Date.now;
    this.applicationPolicy = options.applicationPolicy
      ? Object.freeze({ ...options.applicationPolicy })
      : undefined;
  }
  static async open(options: SupervisorOptions) {
    const journal = await RecoveryJournal.open(options.root, options.databasePath);
    const supervisor = new MaintenanceSupervisor(journal, options);
    try {
      await supervisor.initialize();
      return supervisor;
    } catch (error) {
      await supervisor.close().catch(() => {});
      throw error;
    }
  }
  private async initialize() {
    const previous = structuredClone(this.journal.state);
    const prior = this.journal.state.child;
    const priorVerifier = this.journal.state.verifier;
    let reconciliationFailure: unknown;
    let reconciled = false;
    if (!this.journal.wasUnverified)
      this.transition({
        phase: 'recovery-required',
        epoch: randomUUID(),
        verifiedAt: null,
        lastFailure: 'supervisor-restarted',
      });
    // Public status must never expose a journal's old running phase during boot.
    this.publicServer = createHttpServer((request, response) =>
      this.publicRequest(request, response),
    );
    this.publicServer.requestTimeout = 5000;
    this.publicServer.headersTimeout = 5000;
    await listening(this.publicServer, {
      port: this.options.publicPort ?? 3002,
      host: '127.0.0.1',
    });
    const reconciliationDeadline = Date.now() + (this.options.budgets?.stopMs ?? STOP_MS) + 3000;
    if (prior || priorVerifier) {
      try {
        if (priorVerifier) await this.stopGroup(priorVerifier, false);
        if (prior) await this.stopGroup(prior);
        else assertWorkspaceHandlesClosed(this.journal.databasePath);
        reconciled = true;
      } catch (error) {
        reconciliationFailure = error;
        this.transition({ lastFailure: 'process-still-active' });
      }
    }
    // Surviving children retain the cold and application listeners. They must
    // be reconciled before this controller can acquire either dataset lease.
    const reconciledIdentity = reconciled ? fileIdentity(this.journal.databasePath) : null;
    for (;;) {
      if (
        reconciledIdentity &&
        !sameFile(reconciledIdentity, fileIdentity(this.journal.databasePath))
      )
        throw new Error('Workspace changed while acquiring recovery ownership.');
      try {
        await this.journal.bindWorkspace();
        break;
      } catch (error) {
        // A killed group can disappear from /proc before its last inherited
        // listener is retired. Wait only for a real exclusive bind, within the
        // existing TERM/forced-exit budget. Persistent competitors still fail.
        if (
          reconciled &&
          error instanceof WorkspaceLeaseBusyError &&
          Date.now() < reconciliationDeadline
        ) {
          await delay(25);
          continue;
        }
        if (reconciliationFailure)
          throw new AggregateError(
            [reconciliationFailure, error],
            'Recorded workspace owners could not be reconciled before ownership acquisition.',
          );
        throw error;
      }
    }
    if (reconciled) {
      // Recheck after acquiring ownership, rather than treating the earlier
      // inventory as permission to proceed while the kernel still refused it.
      if (!sameFile(reconciledIdentity, fileIdentity(this.journal.databasePath)))
        throw new Error('Workspace changed while acquiring recovery ownership.');
      assertWorkspaceHandlesClosed(this.journal.databasePath);
      if (this.journal.state.databaseIdentity) this.assertGeneration();
      this.transition({ child: null, verifier: null });
    }
    try {
      if (!reconciliationFailure) {
        await this.reconcileCommittedRestore(previous);
        await this.reconcileUnexecutedRestore();
      }
      this.journal.assertNoPendingRestoreJobs();
    } catch {
      this.failure('restore-job-pending');
    }
    this.reconcileNotice(true);
    // Only expose cold commands after every startup reconciliation has finished;
    // its cleanup must never erase the identity of a newly started child.
    this.journal.checkRoot();
    const socket = this.journal.path('control.sock');
    try {
      const old = lstatSync(socket);
      if (!old.isSocket() || old.uid !== process.getuid!())
        throw new Error('Recovery socket path is not owned.');
      unlinkSync(socket);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.controlServer = createHttpServer((request, response) => {
      void this.coldRequest(request, response);
    });
    this.controlServer.requestTimeout = 5000;
    this.controlServer.headersTimeout = 5000;
    await listening(this.controlServer, { path: socket });
    chmodSync(socket, 0o600);
    this.noticeTimer = setInterval(() => {
      try {
        this.reconcileNotice(false);
      } catch {
        this.failure('journal-unavailable');
      }
    }, 1000);
    this.noticeTimer.unref();
  }
  /** A preexecution admission cannot own database mutation or an opening
   * permit. On restart, fail only its exact closed target; never manufacture new
   * authority or use this historical epoch tolerance for executing a restore. */
  private async reconcileUnexecutedRestore() {
    try {
      const directory = lstatSync(this.journal.path('restore-jobs'));
      if (!directory.isDirectory() || directory.isSymbolicLink())
        throw new Error('Restore job inventory is unavailable.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !this.journal.state.restoreJob)
        return;
      throw error;
    }
    const jobs = new RestoreJobs(this.journal, this.now);
    try {
      const readInventory = () =>
        jobs.list().sort((a, b) => a.intent.id.localeCompare(b.intent.id));
      let inventory = readInventory(); // Every record must be canonical before any cleanup.
      const pending = inventory.filter(
        (record) => record.phase !== 'failed' && !isCommittedRestoreJob(record),
      );
      if (
        pending.length > 1 ||
        pending.some(
          (record) => record.execution || !['accepted', 'source-retained'].includes(record.phase),
        )
      )
        throw new Error('Restore execution requires explicit recovery.');
      const reference = structuredClone(this.journal.state.restoreJob);
      let record = reference
        ? inventory.find((value) => value.intent.id === reference.jobId)
        : pending[0];
      if (reference && (!record || record.intentHash !== reference.intentHash))
        throw new Error('Restore admission reference is missing or conflicting.');
      if (!record) return; // Valid historical terminal records are inert.
      if (
        record.execution ||
        !['accepted', 'source-retained', 'failed'].includes(record.phase) ||
        pending.some((value) => value.intent.id !== record!.intent.id)
      )
        throw new Error('Restore admission is not the sole unexecuted job.');
      const id = record.intent.id,
        hash = record.intentHash,
        target = record.intent.target,
        bootEpoch = this.journal.state.epoch;
      const assertClosed = (expectedReference = reference) => {
        const state = this.journal.state,
          owned = this.journal.workspaceOwnership();
        if (
          this.closing ||
          this.journal.wasUnverified ||
          this.child ||
          this.childOwned ||
          this.childReady ||
          state.child ||
          state.verifier ||
          state.restoreStop ||
          state.operation ||
          !['stopped', 'recovery-required'].includes(state.phase) ||
          state.verifiedAt !== null ||
          state.instanceId !== target.instanceId ||
          state.generationId !== target.generationId ||
          state.epoch !== bootEpoch ||
          this.journal.databasePath !== target.databasePath ||
          owned.databasePath !== target.databasePath ||
          !sameFile(state.databaseIdentity, target.identity) ||
          !sameFile(owned.databaseIdentity, target.identity) ||
          JSON.stringify(state.restoreJob) !== JSON.stringify(expectedReference) ||
          JSON.stringify(readInventory()) !== JSON.stringify(inventory)
        )
          throw new Error('Unexecuted restore admission lost its closed target.');
        this.assertGeneration();
        assertNoPendingRestore(this.journal.databasePath);
        assertWorkspaceHandlesClosed(this.journal.databasePath);
        this.journal.checkRoot();
      };
      assertClosed();
      if (record.phase !== 'failed') {
        // This old intent may be expired and its epoch was rotated at boot. The
        // failed checkpoint grants no opening authority and preserves all intent.
        record = jobs.checkpoint(id, hash, record.revision, 'failed');
        inventory = inventory.map((value) => (value.intent.id === id ? record! : value));
      }
      assertClosed();
      if (JSON.stringify(jobs.read(id)) !== JSON.stringify(record))
        throw new Error('Failed restore admission publication changed.');
      // Publish after the failed record. An uncertain publication is reread on
      // next boot; source custody is never deleted or reinterpreted as authority.
      this.transition({
        phase: 'stopped',
        restoreJob: null,
        verifiedAt: null,
        completedOperationId: id,
        lastFailure: 'restore-admission-abandoned',
      });
      assertClosed(null);
      if (
        this.journal.state.restoreJob ||
        this.journal.state.phase !== 'stopped' ||
        this.journal.state.completedOperationId !== id ||
        this.journal.state.verifiedAt !== null ||
        JSON.stringify(readInventory()) !== JSON.stringify(inventory)
      )
        throw new Error('Restore admission cleanup publication changed.');
      this.assertGeneration();
      assertNoPendingRestore(this.journal.databasePath);
      assertWorkspaceHandlesClosed(this.journal.databasePath);
    } finally {
      jobs.close();
    }
  }
  /** Finish only the already durable winner. No source image is opened or
   * copied: this live file may contain writes acknowledged before the crash. */
  private async reconcileCommittedRestore(previous: RecoveryJournalState) {
    const reference = previous.restoreJob;
    if (!reference) return;
    const jobs = new RestoreJobs(this.journal, this.now);
    try {
      const record = jobs.read(reference.jobId);
      if (!record || !isCommittedRestoreJob(record)) return;
      const permit = selectedRestoreTrial(record)!,
        original = record.execution!.originals!,
        operation = previous.operation;
      if (
        this.journal.wasUnverified ||
        record.intentHash !== reference.intentHash ||
        record.intent.target.instanceId !== previous.instanceId ||
        record.intent.target.databasePath !== this.journal.databasePath ||
        previous.generationId !== permit.generationId ||
        !sameFile(previous.databaseIdentity, permit.identity) ||
        !sameFile(original.identity, permit.identity) ||
        previous.phase === 'running' ||
        previous.verifier ||
        (previous.child &&
          ['pid', 'start', 'boot', 'token'].some(
            (key) =>
              previous.child![key as keyof ProcessIdentity] !==
              permit.child[key as keyof ProcessIdentity],
          )) ||
        (previous.restoreStop &&
          JSON.stringify(previous.restoreStop) !== JSON.stringify(record.execution!.stop)) ||
        operation?.id !== record.intent.id ||
        operation.generationId !== permit.generationId ||
        operation.actorId !== record.intent.authority.actorId ||
        operation.sessionHash !== record.intent.authority.sessionHash ||
        operation.expiresAt !== record.intent.authority.expiresAt ||
        operation.tokenHash !== record.intent.continuationHash
      )
        throw new Error('Committed restore does not match the recorded selected generation.');
      const snapshot = JSON.stringify(record);
      const assertSelected = () => {
        const state = this.journal.state;
        if (
          this.closing ||
          state.instanceId !== previous.instanceId ||
          state.generationId !== permit.generationId ||
          !sameFile(state.databaseIdentity, permit.identity) ||
          !sameFile(this.journal.workspaceOwnership().databaseIdentity, permit.identity) ||
          state.child ||
          state.verifier ||
          state.phase !== 'recovery-required' ||
          state.restoreJob?.jobId !== record.intent.id ||
          state.restoreJob.intentHash !== record.intentHash ||
          JSON.stringify(jobs.read(record.intent.id)) !== snapshot ||
          jobs
            .list()
            .some(
              (other) =>
                other.intent.id !== record.intent.id &&
                other.phase !== 'failed' &&
                !isCommittedRestoreJob(other),
            )
        )
          throw new Error('Committed restore recovery lost its exact selected generation.');
        this.assertGeneration();
        assertWorkspaceHandlesClosed(this.journal.databasePath);
      };
      assertSelected();
      // A fresh boot epoch fences the old process. Its expired authorization is
      // historical evidence, never permission to start another restore attempt.
      // Keep the operation/reference until all terminal cleanup is durable so a
      // second crash can identify this same winner without timestamp guessing.
      this.transition({
        phase: 'recovery-required',
        restoreStop: null,
        verifiedAt: null,
        lastFailure: 'restore-committed-recovery',
      });
      assertSelected();
      await commitRestoreFiles(
        {
          root: this.journal.root,
          databasePath: this.journal.databasePath,
          assertClosed: assertSelected,
          readPhase: () => {
            assertSelected();
            return permit.role === 'candidate' ? 'candidate-committed' : 'original-committed';
          },
          persist: async () => {
            throw new Error('Terminal restore recovery cannot choose another outcome.');
          },
        },
        {
          ...original,
          candidate: { bytes: permit.output.bytes, sha256: permit.output.sha256 },
        },
        permit.role,
      );
      assertSelected();
      assertNoPendingRestore(this.journal.databasePath);
      this.transition({
        restoreJob: null,
        operation: null,
        completedOperationId: record.intent.id,
        verifiedAt: null,
      });
      // Cold verification/start/resume remains explicit, exactly as for any
      // supervisor restart. It verifies current live content, not the prepared
      // fingerprint, and cannot reapply old source bytes over later edits.
      this.journal.assertNoPendingRestoreJobs();
    } finally {
      jobs.close();
    }
  }
  publicAddress(): AddressInfo {
    return this.publicServer!.address() as AddressInfo;
  }
  status(): MaintenanceAdminStatus {
    const state = this.journal.state;
    return {
      available: true,
      phase: state.phase,
      epoch: state.epoch,
      notice: state.notice ? { ...state.notice } : null,
      operationId: state.operation?.id ?? null,
      authorityExpiresAt: state.operation?.expiresAt ?? null,
      generationId: state.generationId,
      lastFailure: state.lastFailure,
      readyToResume: state.phase === 'paused' && this.childReady && state.verifiedAt !== null,
    };
  }
  private transition(patch: Partial<typeof this.journal.state>, beforeBroadcast?: () => void) {
    this.journal.state = { ...this.journal.state, ...patch, updatedAt: this.now() };
    try {
      this.journal.write();
      beforeBroadcast?.();
    } catch (error) {
      this.journal.state = {
        ...this.journal.state,
        phase: 'recovery-required',
        lastFailure: 'journal-unavailable',
        verifiedAt: null,
      };
      this.sendState();
      throw error;
    }
    this.sendState();
    this.options.onTransition?.(this.status());
  }
  private childControlFailed(child: ChildProcess, reason = 'application-disconnected') {
    if (child !== this.child) return;
    // A failed state send must not recursively send another failure state into
    // the same broken channel. During stop, physical closure remains the gate.
    this.childChannelFailed = true;
    if (!this.closing && !['stopping', 'stopped'].includes(this.journal.state.phase))
      this.failure(reason);
  }
  private sendChild(child: ChildProcess, message: Parameters<ChildProcess['send']>[0]) {
    if (child !== this.child || this.childChannelFailed) return;
    if (!child.connected) {
      this.childControlFailed(child);
      return;
    }
    try {
      child.send(message, (error) => {
        if (error) this.childControlFailed(child);
      });
    } catch {
      this.childControlFailed(child);
    }
  }
  private sendState() {
    if (this.child)
      this.sendChild(this.child, {
        channel: MAINTENANCE_CHANNEL,
        kind: 'state',
        status: this.status(),
      });
  }
  private restoreExecutionFailure(id: string, error: unknown) {
    let phase: unknown;
    try {
      const jobs = new RestoreJobs(this.journal);
      try {
        phase = jobs.read(id)?.phase;
      } finally {
        jobs.close();
      }
    } catch {
      /* Missing/uncertain evidence cannot prevent fail-closed handling. */
    }
    this.failure(restoreExecutionFailureReason(phase, error));
  }
  private failure(reason: string) {
    this.childReady = false;
    try {
      this.transition({ phase: 'recovery-required', lastFailure: reason, verifiedAt: null });
    } catch {
      /* The in-memory fallback and independent proxy remain closed. */
    }
    this.drainWaiter?.reject(new Error(safeError));
    this.drainWaiter = undefined;
    this.startWaiter?.reject(new Error(safeError));
    this.startWaiter = undefined;
    this.restoreWaiter?.reject(new Error(safeError));
    this.restoreTrialWaiter?.reject(new Error(safeError));
    this.restoreTrialStopWaiter?.reject(new Error(safeError));
    this.restoreReleaseWaiter?.reject(new Error(safeError));
    this.authorityWaiter?.reject(new Error(safeError));
  }
  private reconcileNotice(restarting: boolean) {
    const notice = this.journal.state.notice;
    if (notice?.state === 'scheduled' && notice.startsAt <= this.now())
      this.transition({ notice: { ...notice, state: restarting ? 'missed' : 'started' } });
    // A cancelled notice stops being news once its announced window has passed.
    // Started and missed notices stay until the Operator cancels them: their
    // expiry must never read as a report that maintenance succeeded.
    else if (
      notice?.state === 'cancelled' &&
      this.journal.state.phase === 'running' &&
      notice.startsAt + notice.durationMinutes * 60_000 <= this.now()
    )
      this.transition({ notice: null });
  }
  private publicRequest(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method === 'GET' && request.url === '/api/maintenance') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify(publicMaintenance(this.status())));
      return;
    }
    response.statusCode = 503;
    response.setHeader('Retry-After', '30');
    if (
      request.url?.startsWith('/api/') ||
      request.url?.startsWith('/sync-api/') ||
      request.url === '/mcp'
    ) {
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          error: 'Workspace maintenance is in progress. Keep pending work on this device.',
          code: 'MAINTENANCE',
        }),
      );
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    );
    response.end(
      '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Spinel maintenance</title><style>body{font:1rem system-ui;max-width:35rem;margin:15vh auto;padding:1.5rem;line-height:1.6;color-scheme:light dark}h1{font-size:1.6rem}</style><h1>Workspace maintenance</h1><p>Spinel is paused. Keep this page open if you have pending edits; they have not been confirmed saved.</p><p>Try again when maintenance ends.</p></html>',
    );
  }
  private async coldRequest(request: IncomingMessage, response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'application/json');
    if (
      request.method !== 'POST' ||
      request.url !== '/control' ||
      request.headers['content-type'] !== 'application/json'
    ) {
      response.statusCode = 404;
      response.end('{}');
      return;
    }
    try {
      let bytes = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 4096) throw new Error('Recovery request is too large.');
        chunks.push(Buffer.from(chunk));
      }
      const result = await this.coldControl(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.end(JSON.stringify(result));
    } catch (error) {
      response.statusCode = 409;
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : safeError }));
    }
  }
  private serial<T>(action: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Recovery control is stopping.'));
    const result = this.queue.then(() => {
      if (this.closing) throw new Error('Recovery control is stopping.');
      return action();
    });
    this.queue = result.catch(() => {});
    return result;
  }
  private receipt(id: string, intent: unknown, expiresAt: number) {
    const intentHash = tokenHash(JSON.stringify(intent));
    const existing = this.journal.state.receipts.find((receipt) => receipt.id === id);
    if (existing) {
      if (existing.intentHash !== intentHash)
        throw new Error('This operation ID was used for different maintenance intent.');
      return { duplicate: true, receipts: this.journal.state.receipts };
    }
    const receipts = this.journal.state.receipts.filter(
      (receipt) => receipt.expiresAt > this.now(),
    );
    if (receipts.length >= 128)
      throw new Error(
        'Too many recent maintenance operations. Wait for their authorization window to end.',
      );
    return { duplicate: false, receipts: [...receipts, { id, intentHash, expiresAt }] };
  }
  control(command: unknown): Promise<MaintenanceControlResult> {
    return this.serial(async () => {
      this.journal.assertNoPendingRestoreJobs();
      if (this.journal.state.restoreStop)
        throw new Error(
          'Finish recovery of the current restore before another maintenance operation.',
        );
      if (!object(command)) throw new Error('Invalid maintenance operation.');
      operationId(command.operationId);
      if (command.action === 'resume') {
        if (
          !exact(command, ['action', 'operationId', 'actorId', 'resumeToken']) ||
          typeof command.actorId !== 'string' ||
          typeof command.resumeToken !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(command.resumeToken)
        )
          throw new Error('Invalid maintenance authorization.');
        const operation = this.journal.state.operation;
        if (
          !operation ||
          operation.id !== command.operationId ||
          operation.actorId !== command.actorId ||
          operation.generationId !== this.journal.state.generationId ||
          operation.expiresAt <= this.now() ||
          !timingSafeEqual(
            Buffer.from(operation.tokenHash, 'hex'),
            Buffer.from(tokenHash(command.resumeToken), 'hex'),
          )
        )
          throw new Error('This maintenance authorization expired. Use the recovery CLI.');
        await this.resume();
        return { status: this.status() };
      }
      authority(command.authority, this.now());
      if (command.action === 'pause') {
        if (!exact(command, ['action', 'operationId', 'authority']))
          throw new Error('Invalid maintenance operation.');
        const receipt = this.receipt(
          command.operationId,
          { action: 'pause' },
          command.authority.expiresAt,
        );
        if (receipt.duplicate) return { status: this.status() };
        const operation = this.journal.state.operation;
        if (
          operation?.id === command.operationId &&
          operation.actorId === command.authority.actorId &&
          operation.sessionHash === command.authority.sessionHash &&
          operation.expiresAt > this.now()
        )
          return { status: this.status() };
        if (this.journal.state.phase !== 'running')
          throw new Error('The workspace is already in maintenance. Use its current operation.');
        const token = randomBytes(32).toString('base64url');
        await this.pause(command.operationId, command.authority, token, receipt.receipts);
        return { status: this.status(), resumeToken: token };
      }
      if (command.action === 'notice') {
        // Scheduling waits for a running workspace; cancelling does not, so an
        // Operator can withdraw a stale announcement during a long pause.
        if (this.journal.state.phase !== 'running')
          throw new Error('Notices can only be scheduled while the workspace is running.');
        if (
          !exact(command, ['action', 'operationId', 'authority', 'notice']) ||
          !object(command.notice) ||
          !exact(command.notice, ['id', 'startsAt', 'timeZone', 'durationMinutes'])
        )
          throw new Error('Invalid maintenance notice.');
        const notice = { ...command.notice, state: 'scheduled' };
        if (
          !validNotice(notice) ||
          notice.startsAt <= this.now() ||
          notice.startsAt > this.now() + 365 * 24 * 60 * 60_000
        )
          throw new Error(
            'Choose a future absolute time, an IANA time zone and a duration up to one day.',
          );
        const normalized = {
          id: notice.id,
          startsAt: notice.startsAt,
          durationMinutes: notice.durationMinutes,
          state: 'scheduled' as const,
          timeZone: new Intl.DateTimeFormat('en', { timeZone: notice.timeZone }).resolvedOptions()
            .timeZone,
        };
        const receipt = this.receipt(
          command.operationId,
          { action: 'notice', notice: normalized },
          command.authority.expiresAt,
        );
        if (receipt.duplicate) return { status: this.status() };
        this.transition({
          notice: normalized,
          completedOperationId: command.operationId,
          receipts: receipt.receipts,
        });
      } else if (command.action === 'cancel-notice') {
        if (!exact(command, ['action', 'operationId', 'authority', 'noticeId']))
          throw new Error('Invalid maintenance notice cancellation.');
        operationId(command.noticeId);
        const receipt = this.receipt(
          command.operationId,
          { action: 'cancel-notice', noticeId: command.noticeId },
          command.authority.expiresAt,
        );
        if (receipt.duplicate) return { status: this.status() };
        if (command.noticeId !== this.journal.state.notice?.id)
          throw new Error('Refresh the current maintenance notice.');
        this.transition({
          notice: { ...this.journal.state.notice!, state: 'cancelled' },
          completedOperationId: command.operationId,
          receipts: receipt.receipts,
        });
      } else throw new Error('Unknown maintenance operation.');
      return { status: this.status() };
    });
  }
  coldControl(command: unknown): Promise<MaintenanceControlResult> {
    return this.serial(async () => {
      if (!object(command) || !exact(command, ['action', 'operationId']))
        throw new Error('Invalid recovery operation.');
      if (command.action === 'status') {
        if (command.operationId !== undefined) throw new Error('Status takes no operation ID.');
        return { status: this.status() };
      }
      if (!['pause', 'stop', 'start', 'verify', 'resume'].includes(String(command.action)))
        throw new Error('Unknown recovery operation.');
      if (command.action !== 'stop') this.journal.assertNoPendingRestoreJobs();
      if (this.journal.state.restoreStop && command.action !== 'stop')
        throw new Error(
          'An unfinished restore witness must be reconciled before another recovery operation.',
        );
      operationId(command.operationId);
      const state = this.journal.state;
      if (state.completedOperationId === command.operationId)
        throw new Error('This operation has already completed.');
      if (state.operation && state.operation.id !== command.operationId)
        throw new Error('Use the exact current operation ID from status.');
      // A protective host stop must not accept an invalid journal or mint new
      // maintenance authority just to close already-paused/recovery resources.
      if (command.action === 'stop') {
        await this.stop();
        return { status: this.status() };
      }
      if (!state.operation) {
        this.journal.acceptJournal();
        this.transition({
          operation: {
            id: command.operationId,
            actorId: 'cold-host',
            sessionHash: '0'.repeat(64),
            tokenHash: tokenHash(randomBytes(32).toString('base64url')),
            expiresAt: this.now() + AUTHORITY_MS,
            generationId: state.generationId,
          },
        });
      }
      if (command.action === 'pause') {
        if (state.phase === 'running') {
          const operation = this.journal.state.operation!;
          await this.pause(command.operationId, {
            actorId: operation.actorId,
            sessionHash: operation.sessionHash,
            expiresAt: this.now() + AUTHORITY_MS,
          });
        } else if (!['paused', 'stopped', 'recovery-required'].includes(state.phase))
          throw new Error('Another transition is still running.');
      } else if (command.action === 'verify') await this.verify();
      else if (command.action === 'start') await this.start();
      else await this.resume();
      return { status: this.status() };
    });
  }
  private async pause(
    id: string,
    proof: MaintenanceAuthority,
    token = randomBytes(32).toString('base64url'),
    receipts: OperationReceipt[] = this.journal.state.receipts,
    plannedEpoch: string = randomUUID(),
  ) {
    if (!uuidPattern.test(plannedEpoch) || plannedEpoch === this.journal.state.epoch)
      throw new Error('Invalid planned maintenance epoch.');
    if (this.journal.state.phase !== 'running' || !this.childReady)
      throw new Error('Only a running, verified application can pause.');
    if (id === this.journal.state.completedOperationId)
      throw new Error('This operation has already completed.');
    const drained = new Promise<void>((resolve, reject) => {
      this.drainWaiter = { resolve, reject };
    });
    this.transition({
      phase: 'draining',
      receipts,
      epoch: plannedEpoch,
      lastFailure: null,
      operation: {
        id,
        actorId: proof.actorId,
        sessionHash: proof.sessionHash,
        expiresAt: proof.expiresAt,
        tokenHash: tokenHash(token),
        generationId: this.journal.state.generationId,
      },
    });
    const timer = setTimeout(
      () => this.failure('drain-timeout'),
      this.options.budgets?.drainMs ?? DRAIN_MS,
    );
    try {
      await drained;
    } finally {
      clearTimeout(timer);
      this.drainWaiter = undefined;
    }
  }
  private assertGeneration() {
    this.journal.checkRoot();
    if (!sameFile(this.journal.state.databaseIdentity, fileIdentity(this.journal.databasePath))) {
      this.failure('generation-changed');
      throw new Error(
        'The workspace generation changed. Keep maintenance active and use cold-host verification.',
      );
    }
  }
  private async resume(assertAuthorized?: () => void, beforeBroadcast?: () => void) {
    assertNoPendingRestore(this.journal.databasePath);
    this.assertGeneration();
    if (
      !this.childReady ||
      this.journal.state.phase !== 'paused' ||
      this.journal.state.verifiedAt === null
    )
      throw new Error('Verify and start the current generation under maintenance before resuming.');
    const completedOperationId = this.journal.state.operation?.id ?? null;
    assertAuthorized?.();
    this.transition(
      { phase: 'running', operation: null, completedOperationId, lastFailure: null },
      beforeBroadcast,
    );
  }
  private async stopGroup(identity: ProcessIdentity, checkHandles = true, force = false) {
    const deadline = Date.now() + (force ? 0 : (this.options.budgets?.stopMs ?? STOP_MS));
    const closedDeadline = deadline + 3000;
    const members = () => waitForProcessInventory(() => groupMembers(identity), closedDeadline);
    const signal = (value: NodeJS.Signals) => {
      // The complete inventory was verified before each signal. A permission
      // refusal, including a zombie with live threads, never permits a kill.
      try {
        process.kill(-identity.pid, value);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    };
    if ((await members()).length) {
      signal(force ? 'SIGKILL' : 'SIGTERM');
      if (!force) while ((await members()).length && Date.now() < deadline) await delay(25);
      if ((await members()).length) {
        if (!force) signal('SIGKILL');
        while ((await members()).length && Date.now() < closedDeadline) await delay(25);
      }
      if ((await members()).length) throw new Error('Application processes are still running.');
    }
    if (checkHandles) {
      const assertDeadline = () => {
        if (Date.now() >= closedDeadline)
          throw new Error('Workspace handle closure exceeded its stop deadline.');
      };
      for (;;) {
        assertDeadline();
        try {
          await waitForProcessInventory(
            () => assertWorkspaceHandlesClosed(this.journal.databasePath),
            closedDeadline,
          );
          assertDeadline();
          break;
        } catch (error) {
          // A process-group scan and the kernel's descriptor teardown are not
          // one atomic observation. A positive open-handle observation remains
          // blocking; recheck closure within the same existing exit budget.
          // Unrelated owners are never signalled, and other errors still refuse.
          const remaining = closedDeadline - Date.now();
          if (!(error instanceof WorkspaceHandlesOpenError) || remaining <= 0) throw error;
          await delay(Math.min(25, remaining));
        }
      }
    }
  }
  private async stop() {
    if (this.journal.state.phase === 'running' || this.journal.state.phase === 'draining')
      throw new Error('Pause and drain accepted work before stopping the application.');
    const identity = this.journal.state.child;
    const record = (patch: Partial<typeof this.journal.state>) => {
      try {
        this.transition(patch);
      } catch {
        // A host stop may contain already-paused/recovery resources even when
        // recording fails. transition keeps the proxy closed; an invalid main
        // journal and independent restore evidence remain untouched.
      }
    };
    this.childReady = false;
    record({ phase: 'stopping' });
    try {
      if (identity) await this.stopGroup(identity);
      else assertWorkspaceHandlesClosed(this.journal.databasePath);
      this.child = undefined;
      this.childOwned = false;
      record({ phase: 'stopped', child: null, verifiedAt: null });
    } catch (error) {
      this.failure('process-still-active');
      throw error;
    }
  }

  /** Internal orchestration boundary. A prepared restore job must own this exact
   * pause operation. This does not authorize activation or replace custody. */
  stopForRestore(jobId: string): Promise<RestoreStopRecord> {
    return this.serial(() => this.stopForRestoreOwned(jobId));
  }
  /** Ends at durable custody ACK. Never pauses, stops or replaces the workspace. */
  admitPreparedRestore(input: RestoreAdmission) {
    const request = structuredClone(input);
    const child = this.child;
    this.restoreAdmissions++;
    return this.serial(() => {
      if (child !== this.child) throw new Error('The originating application changed.');
      return this.admitPreparedRestoreOwned(request);
    }).finally(() => {
      this.restoreAdmissions--;
    });
  }
  /** Separate from source admission. Resolves after the durable pause plan,
   * before drain, so an eventual HTTP caller can release its request permit.
   * The registry invokes this only after receiving the separate custody ACK. */
  async beginPreparedRestore(input: { id: string; intentHash: string; continuationToken: string }) {
    const request = structuredClone(input),
      originatingChild = this.child;
    if (this.closing) throw new Error('Recovery control is stopping.');
    const authenticate = (record: RestoreJobRecord | undefined) => {
      if (
        !record ||
        record.intentHash !== request.intentHash ||
        typeof request.continuationToken !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(request.continuationToken) ||
        !timingSafeEqual(
          Buffer.from(record.intent.continuationHash, 'hex'),
          Buffer.from(tokenHash(request.continuationToken), 'hex'),
        )
      )
        throw new Error('Restore continuation does not match its original intent.');
      return record;
    };
    // Publication is synchronous under our exclusive root lock. A retry can
    // observe it between queue awaits without joining the drain-owning action.
    const observer = new RestoreJobs(this.journal, this.now);
    try {
      const record = authenticate(observer.read(request.id));
      if (record.execution) return { record, queued: this.restoreExecution !== undefined };
    } finally {
      observer.close();
    }
    return this.serial(async () => {
      const jobs = new RestoreJobs(this.journal, this.now);
      const controller = new AbortController();
      let planAttempted = false;
      try {
        const record = authenticate(jobs.read(request.id));
        // Lost acknowledgements observe existing execution; never renew its
        // authority or schedule a second pause from a later generation.
        if (record.execution) return { record, queued: this.restoreExecution !== undefined };
        if (record.phase !== 'source-retained')
          throw new Error('Restore source custody is incomplete.');
        const assertRunning = () => {
          const state = this.journal.state,
            target = record.intent.target;
          if (
            this.closing ||
            originatingChild !== this.child ||
            !this.child?.connected ||
            !this.childReady ||
            !this.childOwned ||
            state.phase !== 'running' ||
            state.restoreStop ||
            state.instanceId !== target.instanceId ||
            state.epoch !== target.epoch ||
            state.generationId !== target.generationId ||
            !sameFile(state.databaseIdentity, target.identity) ||
            state.restoreJob?.jobId !== request.id ||
            state.restoreJob.intentHash !== request.intentHash ||
            this.now() < record.intent.authority.verifiedAt ||
            this.now() >= record.intent.authority.expiresAt
          )
            throw new Error('The original restore confirmation is no longer current.');
          this.assertGeneration();
        };
        assertRunning();
        this.restoreAdmissionAbort = controller;
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(
            Math.max(1, Math.min(AUTHORITY_MS, record.intent.authority.expiresAt - this.now())),
          ),
        ]);
        await readRetainedRestoreSource({
          root: this.journal.root,
          manifest: record.intent.source,
          assertRoot: assertRunning,
          signal,
        });
        await this.recheckRestoreAuthorityOwned(request.id, record.intent.authority);
        assertRunning();
        signal.throwIfAborted();
        const capacity = estimateRestoreCapacity(
          {
            databasePath: this.journal.databasePath,
            identity: record.intent.target.identity,
            recoveryRoot: this.journal.root,
            archiveBytes: record.intent.source.archive.bytes,
            databaseBytes: record.intent.source.candidate.bytes,
            previewDatabaseBytes: record.intent.previewDatabaseBytes,
            sourceRetained: true,
            checkedAt: this.now(),
          },
          this.options.restoreCapacityVolume,
        );
        // No pause/witness/custody is possible before this whole-cutover check.
        // Recheck authority after synchronous filesystem work too.
        assertRunning();
        signal.throwIfAborted();
        if (!capacity.sufficient) {
          if (!this.journal.state.child) throw new Error(RESTORE_RPC_ERROR);
          throw new RestoreBeginCapacityError(record, this.journal.state.child);
        }
        planAttempted = true;
        const planned = jobs.planPause(
          request.id,
          request.intentHash,
          record.revision,
          randomUUID(),
        );
        // Append to the existing queue without awaiting it. The plan response
        // settles before this action can wait for application drain.
        const execution = this.serial(() => this.executeRestoreStopOwned(request));
        this.restoreExecution = execution;
        void execution
          .catch((error) => {
            try {
              this.restoreExecutionFailure(request.id, error);
            } catch {
              /* Retain durable job/reference for host recovery. */
            }
          })
          .finally(() => {
            if (this.restoreExecution === execution) this.restoreExecution = undefined;
          });
        return { record: planned, queued: true };
      } catch (error) {
        if (planAttempted) this.restoreExecutionFailure(request.id, error);
        throw error;
      } finally {
        controller.abort();
        if (this.restoreAdmissionAbort === controller) this.restoreAdmissionAbort = undefined;
        jobs.close();
      }
    });
  }
  private async executeRestoreStopOwned(request: {
    id: string;
    intentHash: string;
    continuationToken: string;
  }) {
    const jobs = new RestoreJobs(this.journal, this.now);
    const controller = new AbortController();
    this.restoreAdmissionAbort = controller;
    try {
      let record = jobs.read(request.id);
      if (
        !record ||
        record.intentHash !== request.intentHash ||
        record.phase !== 'pause-planned' ||
        !record.execution
      )
        throw new Error('Restore pause plan is unavailable.');
      const plan = record.execution,
        state = this.journal.state,
        child = state.child;
      if (
        this.closing ||
        !this.childReady ||
        !this.childOwned ||
        !this.child?.connected ||
        !child ||
        child.pid !== plan.child.pid ||
        child.start !== plan.child.start ||
        child.boot !== plan.child.boot ||
        child.token !== plan.child.token ||
        state.phase !== 'running' ||
        state.restoreStop ||
        state.restoreJob?.jobId !== request.id ||
        state.restoreJob.intentHash !== request.intentHash ||
        state.instanceId !== record.intent.target.instanceId ||
        !sameFile(state.databaseIdentity, record.intent.target.identity) ||
        state.generationId !== record.intent.target.generationId ||
        state.epoch !== record.intent.target.epoch ||
        this.now() < record.intent.authority.verifiedAt ||
        this.now() >= record.intent.authority.expiresAt
      )
        throw new Error('Restore pause plan changed.');
      this.assertGeneration();
      await this.pause(
        request.id,
        record.intent.authority,
        request.continuationToken,
        state.receipts,
        plan.epoch,
      );
      record = jobs.markPaused(request.id, request.intentHash, record.revision);
      await this.stopForRestoreOwned(request.id, {
        request: (stop) => {
          record = jobs.planStop(request.id, request.intentHash, record!.revision, stop);
        },
        witness: (stop) => {
          record = jobs.acceptWitness(request.id, request.intentHash, record!.revision, stop);
        },
      });
      record = jobs.markStopped(request.id, request.intentHash, record.revision);
      const budget = this.options.budgets?.restoreMs ?? 120_000;
      const deadline = Date.now() + budget;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(budget)]);
      const assertBudget = () => {
        signal.throwIfAborted();
        if (Date.now() >= deadline) throw new Error('Restore custody exceeded its time budget.');
      };
      const assertClosed = () => {
        assertBudget();
        const state = this.journal.state,
          target = record!.intent.target,
          stop = record!.execution!.stop!;
        if (
          this.closing ||
          this.child ||
          state.child ||
          state.phase !== 'stopped' ||
          state.restoreJob?.jobId !== request.id ||
          state.restoreJob.intentHash !== request.intentHash ||
          state.instanceId !== target.instanceId ||
          state.generationId !== target.generationId ||
          state.epoch !== plan.epoch ||
          !sameFile(state.databaseIdentity, target.identity) ||
          !state.restoreStop ||
          !sameRestoreStopRequest(state.restoreStop.request, stop.request) ||
          state.restoreStop.fingerprint !== stop.fingerprint ||
          groupMembers(plan.child).length
        )
          throw new Error('Restore original closure changed.');
        this.assertGeneration();
        assertWorkspaceHandlesClosed(this.journal.databasePath);
        assertBudget();
      };
      const custody = {
        root: this.journal.root,
        id: request.id,
        databasePath: this.journal.databasePath,
        assertClosed,
        signal,
      };
      const originals = await captureRestoreOriginals(custody);
      record = jobs.planOriginals(request.id, request.intentHash, record.revision, originals);
      await preserveRestoreOriginals(custody, record.execution!.originals!);
      record = jobs.markOriginalsRetained(request.id, request.intentHash, record.revision);
      assertClosed();
      record = jobs.planFreeze(request.id, request.intentHash, record.revision, randomUUID());
      const retained = join(this.journal.root, `restore-${request.id}`);
      const stagingRoot = join(retained, `freeze-${record.execution!.freezeSlot!}`);
      // This bounded slot was selected durably. Existing/partial work is never
      // silently replaced by a fresh worker directory after interruption.
      mkdirSync(stagingRoot, { mode: 0o700 });
      await syncRestoreDirectory(stagingRoot, signal);
      await syncRestoreDirectory(retained, signal);
      assertClosed();
      const originalPath = join(retained, 'original', 'spinel.sqlite');
      const frozen = await freezeCurrentRestore({
        database: { path: originalPath, ...originals.original['spinel.sqlite']! },
        ...(originals.original['spinel.sqlite-wal'] && {
          wal: { path: originalPath + '-wal', ...originals.original['spinel.sqlite-wal'] },
        }),
        fingerprint: record.execution!.stop!.fingerprint!,
        authority: record.intent.authority,
        stagingRoot,
        timeoutMs: Math.max(1, Math.min(budget, deadline - Date.now())),
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(
            Math.max(1, Math.min(AUTHORITY_MS, record.intent.authority.expiresAt - this.now())),
          ),
        ]),
      });
      // Retain successful worker output even if this publication is uncertain.
      // The worker syncs its output directory; its new entry in this reserved
      // parent must also be durable before the job can reference that output.
      await syncRestoreDirectory(stagingRoot, signal);
      assertClosed();
      if (
        dirname(dirname(frozen.databasePath)) !== stagingRoot ||
        basename(frozen.databasePath) !== 'frozen.sqlite'
      )
        throw new Error('Frozen restore output escaped its planned slot.');
      record = jobs.markFrozen(request.id, request.intentHash, record.revision, {
        directory: basename(dirname(frozen.databasePath)),
        bytes: frozen.databaseBytes,
        sha256: frozen.databaseSha256,
        fingerprint: frozen.fingerprint,
      });
      assertBudget();
      record = await prepareRestoreAttempt({
        jobs,
        record,
        root: this.journal.root,
        now: this.now,
        signal,
        assertClosed,
        deadline,
      });
      assertClosed();
      record = await activateRestoreAttempt({
        jobs,
        record,
        root: this.journal.root,
        databasePath: this.journal.databasePath,
        now: this.now,
        signal,
        assertClosed,
        deadline,
      });
      assertClosed();
      try {
        record = await this.startRestoreTrialOwned(jobs, record, signal, deadline);
        await this.commitRestoreTrialOwned(jobs, record, signal, deadline);
      } catch (error) {
        const failed = error instanceof WitnessedRestoreTrialFailure ? error.record : undefined;
        // A committed winner, missing witness or partial preparation is never a
        // new rollback opportunity. Only this exact fully retained failed trial
        // may make the one original-content attempt under the unchanged proof.
        if (
          failed?.phase !== 'trial-frozen' ||
          JSON.stringify(jobs.read(request.id)) !== JSON.stringify(failed)
        )
          throw error;
        await this.restoreOriginalOwned(jobs, failed, signal, deadline);
      }
    } finally {
      controller.abort();
      if (this.restoreAdmissionAbort === controller) this.restoreAdmissionAbort = undefined;
      jobs.close();
    }
  }
  private async admitPreparedRestoreOwned(request: RestoreAdmission) {
    operationId(request.id);
    const policy = this.applicationPolicy;
    if (
      !policy?.image ||
      !validRestoreAuthority(request.authority) ||
      !validRestorePreview(request.preview) ||
      !validRestorePreviewBytes(request.previewDatabaseBytes) ||
      request.consequenceEnvelope !== 1 ||
      !Number.isSafeInteger(request.confirmedAt) ||
      request.confirmedAt > this.now()
    )
      throw new Error('Restore requires captured deployment policy and original confirmation.');
    const source = request.source;
    for (const path of [source.databasePath, source.archive.path])
      if (
        typeof path !== 'string' ||
        !isAbsolute(path) ||
        resolve(path) !== path ||
        path.includes('\0') ||
        Buffer.byteLength(path) > 4096
      )
        throw new Error('Invalid private prepared source.');
    const manifest: RestoreSourceManifest = {
      version: 1,
      id: request.id,
      archive: { bytes: source.archive.bytes, sha256: source.archive.sha256 },
      candidate: { bytes: source.databaseBytes, sha256: source.databaseSha256 },
      recovery: { ...source.recovery },
    };
    if (
      !validRestoreSourceManifest(manifest) ||
      manifest.recovery.image !== policy.image ||
      manifest.recovery.origin !== policy.origin
    )
      throw new Error('The prepared source does not match deployment policy.');
    const child = this.child;
    const initial = this.journal.state;
    const identity = initial.child ? { ...initial.child } : null;
    const target = {
      instanceId: initial.instanceId,
      generationId: request.generationId,
      epoch: request.epoch,
      databasePath: this.journal.databasePath,
      identity: initial.databaseIdentity ? { ...initial.databaseIdentity } : null,
    };
    const assertTarget = () => {
      const state = this.journal.state;
      if (
        this.closing ||
        !child?.connected ||
        child !== this.child ||
        !this.childReady ||
        !this.childOwned ||
        !identity ||
        !state.child ||
        child.pid !== identity.pid ||
        state.child.pid !== identity.pid ||
        state.child.start !== identity.start ||
        state.child.boot !== identity.boot ||
        state.child.token !== identity.token ||
        state.phase !== 'running' ||
        state.restoreStop ||
        state.instanceId !== target.instanceId ||
        state.generationId !== target.generationId ||
        state.epoch !== target.epoch ||
        !sameFile(state.databaseIdentity, target.identity)
      )
        throw new Error('Restore confirmation no longer matches the running workspace.');
      this.assertGeneration();
    };
    const assertActive = () => {
      assertTarget();
      // Synchronous filesystem work can cross expiry before the abort timer runs.
      const now = this.now();
      if (now < request.authority.verifiedAt || now >= request.authority.expiresAt)
        throw new Error('The original restore authorization expired.');
    };
    assertTarget();
    const jobs = new RestoreJobs(this.journal, this.now);
    let publicationStarted = false;
    let referenceDurable = false;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(
        Math.max(1, Math.min(AUTHORITY_MS, request.authority.expiresAt - this.now())),
      ),
    ]);
    this.restoreAdmissionAbort = controller;
    try {
      // Retry lookup precedes randomness and preserves the original confirmation.
      const existing = jobs.read(request.id);
      const token = existing ? undefined : randomBytes(32).toString('base64url');
      const intent: RestoreJobIntent = {
        version: 1,
        id: request.id,
        target: { ...target, identity: target.identity! },
        source: manifest,
        policy: {
          origin: policy.origin,
          image: policy.image,
          spacesEnabled: policy.spaceReview,
          staticDirectory: policy.staticDirectory,
          consequencesVersion: 1,
        },
        authority: request.authority,
        confirmedAt: request.confirmedAt,
        preview: structuredClone(request.preview),
        previewDatabaseBytes: request.previewDatabaseBytes,
        consequenceEnvelope: request.consequenceEnvelope,
        continuationHash: existing?.intent.continuationHash ?? tokenHash(token!),
      };
      const hash = restoreIntentHash(intent);
      if (existing && existing.intentHash !== hash)
        throw new Error('Restore job ID already has different intent.');
      if (existing?.execution) throw new Error('Restore execution has already begun.');
      const reference = this.journal.state.restoreJob;
      if (reference && (reference.jobId !== request.id || reference.intentHash !== hash))
        throw new Error('Finish the current restore job first.');
      if (existing?.phase === 'failed') return { record: existing, custody: false };
      await this.recheckRestoreAuthorityOwned(request.id, request.authority);
      assertActive();
      signal.throwIfAborted();
      publicationStarted = true;
      let record = jobs.admit(intent).record;
      if (token) this.restoreContinuation = { id: request.id, intentHash: hash, token };
      this.transition({ restoreJob: { jobId: request.id, intentHash: hash } });
      referenceDurable = true;
      const assertRoot = () => {
        assertActive();
        signal.throwIfAborted();
      };
      if (record.phase === 'source-retained')
        await readRetainedRestoreSource({ root: this.journal.root, manifest, assertRoot, signal });
      else
        await retainRestoreSource({
          root: this.journal.root,
          id: request.id,
          source,
          assertRoot,
          signal,
        });
      await this.recheckRestoreAuthorityOwned(request.id, request.authority);
      assertActive();
      signal.throwIfAborted();
      if (record.phase === 'accepted')
        record = jobs.checkpoint(request.id, hash, record.revision, 'source-retained');
      assertActive();
      signal.throwIfAborted();
      const continuation = this.restoreContinuation;
      return {
        record,
        custody: true,
        continuationToken:
          continuation?.id === request.id && continuation.intentHash === hash
            ? continuation.token
            : undefined,
      };
    } catch (error) {
      if (publicationStarted) {
        // Only certain pre-mutation failure may release the independent guard.
        // Uncertain store/journal publication remains fenced for host recovery.
        try {
          const record = jobs.read(request.id);
          // A full inventory or another active job can refuse before publication.
          // With a certain absent record, there is no admission to roll back.
          if (!record) {
            publicationStarted = false;
            throw error;
          }
          if (!referenceDurable) throw error;
          assertTarget();
          const reference = this.journal.state.restoreJob;
          if (
            !record ||
            !reference ||
            reference.jobId !== record.intent.id ||
            reference.intentHash !== record.intentHash
          )
            throw error;
          jobs.checkpoint(record.intent.id, record.intentHash, record.revision, 'failed');
          this.transition({ restoreJob: null });
        } catch {
          if (publicationStarted) this.failure('restore-admission-unresolved');
        }
        if (publicationStarted) this.restoreContinuation = undefined;
      }
      throw error;
    } finally {
      controller.abort();
      this.restoreAdmissionAbort = undefined;
      jobs.close();
    }
  }
  /** Read-only private probe. Success is neither admission nor activation authority. */
  recheckRestoreAuthority(jobId: string, original: RestoreAuthority): Promise<void> {
    // Snapshot before queueing: a caller cannot replace proof fields while waiting.
    const proof = structuredClone(original);
    return this.serial(() => this.recheckRestoreAuthorityOwned(jobId, proof));
  }
  private async recheckRestoreAuthorityOwned(jobId: string, proof: RestoreAuthority) {
    operationId(jobId);
    if (!validRestoreAuthority(proof)) throw new Error('Invalid original restore authority.');
    const state = this.journal.state;
    const child = this.child;
    const identity = state.child ? { ...state.child } : null;
    const databaseIdentity = state.databaseIdentity ? { ...state.databaseIdentity } : null;
    const request: RestoreStopRequest = {
      jobId,
      challengeId: randomUUID(),
      generationId: state.generationId,
      epoch: state.epoch,
      deadline: Math.min(proof.expiresAt, this.now() + 5000),
    };
    const assertCurrent = () => {
      const current = this.journal.state;
      if (
        this.closing ||
        (this.authorityWaiter !== undefined && this.authorityWaiter.request !== request) ||
        !child ||
        this.child !== child ||
        !child.connected ||
        !this.childReady ||
        !this.childOwned ||
        !identity ||
        child.pid !== identity.pid ||
        !current.child ||
        current.child.pid !== identity.pid ||
        current.child.start !== identity.start ||
        current.child.boot !== identity.boot ||
        current.child.token !== identity.token ||
        current.phase !== 'running' ||
        current.restoreStop ||
        current.generationId !== request.generationId ||
        current.epoch !== request.epoch ||
        !sameFile(current.databaseIdentity, databaseIdentity) ||
        proof.verifiedAt > this.now() ||
        this.now() >= request.deadline
      )
        throw new Error('The original restore authority has no current application challenge.');
      this.assertGeneration();
      if (this.now() >= request.deadline)
        throw new Error('The restore authority challenge expired.');
    };
    assertCurrent();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        this.authorityWaiter = {
          request,
          reject,
          accept: () => {
            try {
              assertCurrent();
              resolve();
            } catch (error) {
              reject(error);
            }
          },
        };
        timer = setTimeout(
          () => reject(new Error('Restore authority recheck timed out.')),
          Math.max(1, Math.min(5000, request.deadline - this.now())),
        );
        child!.send(
          { channel: MAINTENANCE_CHANNEL, kind: 'restore-authority', request, authority: proof },
          (error) => {
            if (error) reject(new Error('Restore authority channel disconnected.'));
          },
        );
      });
      assertCurrent();
    } finally {
      clearTimeout(timer);
      this.authorityWaiter = undefined;
    }
  }
  /** The restore controller already owns serial(); witness replies remain out of band. */
  private watchRestoreShutdown(identity: ProcessIdentity, fail: () => void) {
    let sampling = false;
    return setInterval(async () => {
      if (sampling) return;
      sampling = true;
      try {
        await checkVerificationHeadroom('running');
        let rss = 0;
        for (const pid of groupMembers(identity)) {
          try {
            rss += Number(
              /^VmRSS:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1] ?? 0,
            );
          } catch (error) {
            if (!processResourcesReleased(String(pid))) throw error;
          }
        }
        if (rss > 512 * 1024) throw new Error('Restore shutdown exceeded its memory budget.');
      } catch {
        fail();
      } finally {
        sampling = false;
      }
    }, 100);
  }
  private async stopForRestoreOwned(
    jobId: string,
    checkpoint?: {
      request(record: RestoreStopRecord): void;
      witness(record: RestoreStopRecord): void;
    },
  ): Promise<RestoreStopRecord> {
    operationId(jobId);
    const state = this.journal.state;
    const child = this.child;
    const identity = state.child;
    if (
      this.closing ||
      state.phase !== 'paused' ||
      !this.childReady ||
      !this.childOwned ||
      !child?.connected ||
      !identity ||
      state.restoreStop ||
      !state.databaseIdentity ||
      state.operation?.id !== jobId ||
      state.operation.generationId !== state.generationId ||
      state.operation.expiresAt <= this.now()
    )
      throw new Error('Restore shutdown requires its current, authorized pause.');
    this.assertGeneration();
    await checkVerificationHeadroom('start');
    if (
      this.journal.state !== state ||
      this.child !== child ||
      !child.connected ||
      this.closing ||
      state.operation.expiresAt <= this.now()
    )
      throw new Error('Restore shutdown authority changed during admission.');
    const budget = this.options.budgets?.restoreMs ?? 120_000;
    if (!Number.isInteger(budget) || budget < 1 || budget > 600_000)
      throw new Error('Invalid restore shutdown budget.');
    const record: RestoreStopRecord = {
      request: {
        jobId,
        challengeId: randomUUID(),
        epoch: state.epoch,
        generationId: state.generationId,
        deadline: this.now() + budget,
      },
      databaseIdentity: { ...state.databaseIdentity },
      child: { ...identity },
      fingerprint: null,
      acceptedAt: null,
    };
    const witness = new Promise<RestoreStopRecord>((resolve, reject) => {
      this.restoreWaiter = { resolve, reject };
    });
    void witness.catch(() => {});
    const waiter = this.restoreWaiter!;
    let forceStop = false;
    const memory = this.watchRestoreShutdown(identity, () => {
      forceStop = true;
      waiter.reject(new Error('Restore shutdown has insufficient memory headroom.'));
    });
    const timeout = setTimeout(() => {
      forceStop = true;
      waiter.reject(new Error('Restore shutdown timed out.'));
    }, budget);
    try {
      checkpoint?.request(record);
      if (this.now() >= state.operation.expiresAt || this.now() >= record.request.deadline)
        throw new Error('Restore shutdown authority expired during planning.');
      this.restoreWitnessCheckpoint = checkpoint?.witness;
      this.childReady = false;
      // Persist the challenge before directing the child to its one-shot
      // shutdown. Ordinary SIGTERM must not race challenge registration.
      this.transition({ phase: 'stopping', restoreStop: record, verifiedAt: null });
      if (this.now() >= state.operation.expiresAt || this.now() >= record.request.deadline)
        throw new Error('Restore shutdown authority expired before dispatch.');
      child.send(
        { channel: MAINTENANCE_CHANNEL, kind: 'restore-stop', request: record.request },
        (error) => {
          if (error) waiter.reject(new Error('Restore shutdown control disconnected.'));
        },
      );
      const accepted = await witness;
      clearTimeout(timeout);
      clearInterval(memory);
      // Durable witness and complete process/handle closure are independent.
      await this.stopGroup(identity);
      if (
        this.closing ||
        this.journal.state.phase !== 'stopping' ||
        this.journal.state.restoreStop?.fingerprint !== accepted.fingerprint
      )
        throw new Error('Restore shutdown lost its control binding.');
      this.child = undefined;
      this.childOwned = false;
      this.transition({ phase: 'stopped', child: null, verifiedAt: null });
      return structuredClone(accepted);
    } catch (error) {
      try {
        await this.stopGroup(identity, true, forceStop || this.now() >= record.request.deadline);
        this.child = undefined;
        this.childOwned = false;
        this.transition({ child: null });
      } catch {
        /* Retain unresolved process identity for restart recovery. */
      }
      this.failure('restore-witness-failed');
      throw error;
    } finally {
      clearTimeout(timeout);
      clearInterval(memory);
      this.restoreWaiter = undefined;
      this.restoreWitnessCheckpoint = undefined;
    }
  }
  private async verify() {
    this.journal.assertNoPendingRestoreJobs();
    assertNoPendingRestore(this.journal.databasePath);
    if (
      this.childReady ||
      this.child?.exitCode === null ||
      (this.journal.state.child && groupMembers(this.journal.state.child).length)
    )
      throw new Error('Stop the application before verifying its closed workspace.');
    await this.journal.bindWorkspace();
    this.journal.assertNoPendingRestoreJobs();
    assertWorkspaceHandlesClosed(this.journal.databasePath);
    const current = fileIdentity(this.journal.databasePath);
    if (
      this.journal.state.databaseIdentity &&
      !sameFile(current, this.journal.state.databaseIdentity)
    ) {
      this.failure('generation-changed');
      throw new Error(
        'The configured dataset has changed. This maintenance control cannot activate replacements.',
      );
    }
    const groupToken = randomUUID();
    const worker = fork(fileURLToPath(new URL('./verify-worker.ts', import.meta.url)), [], {
      env: {
        ...process.env,
        DATABASE_PATH: this.journal.databasePath,
        SPINEL_PROCESS_GROUP_TOKEN: groupToken,
      },
      execArgv: [
        '--max-old-space-size=64',
        '--max-semi-space-size=4',
        `--process-timeout=${Math.max(1, Math.ceil((this.options.budgets?.verifyMs ?? VERIFY_MS) / 1000))}s`,
      ],
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      detached: true,
    });
    const workerIdentity = worker.pid ? processIdentity(worker.pid, groupToken) : null;
    if (!workerIdentity) throw new Error('Recovery verification process did not start.');
    let result = false;
    const exited = new Promise<number | null>((resolveExit) => {
      worker.on('message', (value: unknown) => {
        if (object(value) && value.ok === true) result = true;
      });
      worker.once('error', () => resolveExit(null));
      worker.once('exit', (code) => resolveExit(code));
    });
    // Covers process startup and every handoff/ack wait, not just SQLite work.
    const timeout = setTimeout(() => {
      try {
        if (groupMembers(workerIdentity).length) process.kill(-workerIdentity.pid, 'SIGKILL');
      } catch {
        /* An inconclusive identity remains closed; never signal another group. */
      }
    }, this.options.budgets?.verifyMs ?? VERIFY_MS);
    try {
      this.transition({ verifier: workerIdentity });
      const [exit] = await Promise.all([
        exited,
        shareWorkspaceOwnership(
          worker,
          this.journal.workspaceOwnership(),
          this.options.budgets?.verifyMs ?? VERIFY_MS,
        ),
      ]);
      assertWorkspaceHandlesClosed(this.journal.databasePath);
      if (!result || exit !== 0 || !sameFile(current, fileIdentity(this.journal.databasePath)))
        throw new Error('The current workspace did not pass closed integrity verification.');
      this.journal.acceptJournal();
      this.transition({
        phase: 'stopped',
        databaseIdentity: current,
        child: null,
        verifier: null,
        verifiedAt: this.now(),
        lastFailure: null,
      });
    } catch (error) {
      this.failure('verification-failed');
      await this.stopGroup(workerIdentity, false).catch(() => {});
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  private applicationEnvironment() {
    const environment = childEnvironment();
    delete environment.SPINEL_RESTORE_TRIAL;
    const policy = this.applicationPolicy;
    if (policy) {
      environment.APP_ORIGIN = policy.origin;
      environment.SPINEL_SPACE_REVIEW = policy.spaceReview ? '1' : '0';
      environment.SPINEL_STATIC_DIRECTORY = policy.staticDirectory;
      if (policy.image === undefined) delete environment.SPINEL_IMAGE;
      else environment.SPINEL_IMAGE = policy.image;
    }
    return environment;
  }
  private async restoreOriginalOwned(
    jobs: RestoreJobs,
    initial: RestoreJobRecord,
    signal: AbortSignal,
    deadline: number,
  ) {
    if (initial.phase !== 'trial-frozen' || !initial.execution?.failure?.freeze?.output)
      throw new Error('Original recovery requires an independently witnessed failed trial.');
    const failedPermit = initial.execution.trial!;
    const assertClosed = () => {
      signal.throwIfAborted();
      const state = this.journal.state,
        current = jobs.read(initial.intent.id),
        time = this.now();
      if (
        this.closing ||
        this.child ||
        this.childOwned ||
        this.childReady ||
        state.child ||
        state.verifier ||
        !['stopped', 'recovery-required'].includes(state.phase) ||
        state.verifiedAt !== null ||
        !current ||
        current.intentHash !== initial.intentHash ||
        !(current.phase === 'trial-frozen' || current.phase.startsWith('original-')) ||
        ['candidate-committed', 'original-committed'].includes(current.phase) ||
        !Number.isSafeInteger(time) ||
        time < Math.max(current.updatedAt, state.updatedAt) ||
        time >= initial.intent.authority.expiresAt ||
        time >= deadline ||
        Date.now() >= deadline ||
        state.restoreJob?.jobId !== initial.intent.id ||
        state.restoreJob.intentHash !== initial.intentHash ||
        state.instanceId !== initial.intent.target.instanceId ||
        state.generationId !== failedPermit.generationId ||
        state.epoch !== failedPermit.epoch ||
        !sameFile(state.databaseIdentity, initial.intent.target.identity) ||
        !sameFile(
          this.journal.workspaceOwnership().databaseIdentity,
          initial.intent.target.identity,
        ) ||
        state.operation?.id !== initial.intent.id ||
        state.operation.generationId !== failedPermit.generationId ||
        state.operation.actorId !== initial.intent.authority.actorId ||
        state.operation.sessionHash !== initial.intent.authority.sessionHash ||
        state.operation.expiresAt !== initial.intent.authority.expiresAt ||
        state.operation.tokenHash !== initial.intent.continuationHash ||
        JSON.stringify(state.restoreStop) !== JSON.stringify(initial.execution!.stop) ||
        JSON.stringify(current.execution?.failure) !== JSON.stringify(initial.execution!.failure) ||
        groupMembers(failedPermit.child).length
      )
        throw new Error('Original recovery lost its closed failed-attempt boundary.');
      this.assertGeneration();
      assertWorkspaceHandlesClosed(this.journal.databasePath);
      signal.throwIfAborted();
      if (
        this.now() >= Math.min(deadline, initial.intent.authority.expiresAt) ||
        Date.now() >= deadline
      )
        throw new Error('Original recovery deadline expired.');
    };
    assertClosed();
    this.transition({ phase: 'stopped', verifiedAt: null });
    assertClosed();
    const activated = await prepareAndActivateRestoreOriginal({
      jobs,
      record: initial,
      root: this.journal.root,
      databasePath: this.journal.databasePath,
      now: this.now,
      signal,
      deadline,
      assertClosed,
    });
    assertClosed();
    const ready = await this.startRestoreTrialOwned(jobs, activated, signal, deadline);
    return this.commitRestoreTrialOwned(jobs, ready, signal, deadline);
  }
  private async startRestoreTrialOwned(
    jobs: RestoreJobs,
    initial: RestoreJobRecord,
    signal: AbortSignal,
    deadline: number,
  ) {
    const original = initial.phase === 'original-activated';
    const selected = original ? initial.execution?.rollback : initial.execution;
    const attempt = selected?.attempt,
      output = original
        ? initial.execution?.rollback?.image
        : initial.execution?.preparation?.candidate,
      operation = this.journal.state.operation;
    if (
      !['candidate-activated', 'original-activated'].includes(initial.phase) ||
      !attempt ||
      !output ||
      !operation ||
      this.child ||
      this.journal.state.child ||
      this.journal.state.phase !== 'stopped'
    )
      throw new Error('Restore candidate is not ready for its private trial.');
    signal.throwIfAborted();
    this.assertGeneration();
    assertWorkspaceHandlesClosed(this.journal.databasePath);
    const trialDeadline = Math.min(
      deadline,
      initial.intent.authority.expiresAt,
      Date.now() + (this.options.budgets?.startMs ?? START_MS),
    );
    if (trialDeadline <= Date.now()) throw new Error('Restore trial authority expired.');
    const { child, identity } = this.launchApplicationChild(true);
    const permit: RestoreTrialPermit = {
      version: 1,
      jobId: initial.intent.id,
      intentHash: initial.intentHash,
      attemptId: attempt.attemptId,
      role: original ? 'original' : 'candidate',
      nonce: attempt.nonce,
      child: identity,
      generationId: attempt.generationId,
      epoch: attempt.epoch,
      databasePath: this.journal.databasePath,
      identity: initial.intent.target.identity,
      output: { bytes: output.bytes, sha256: output.sha256, fingerprint: output.fingerprint },
      policy: initial.intent.policy,
      maximumBytes: 8 * 1024 ** 3,
      deadline: trialDeadline,
    };
    let record = initial;
    const assertClock = () => {
      signal.throwIfAborted();
      const time = this.now();
      if (
        !Number.isSafeInteger(time) ||
        Date.now() >= permit.deadline ||
        time < Math.max(record.updatedAt, this.journal.state.updatedAt) ||
        time >= initial.intent.authority.expiresAt
      )
        throw new Error('Restore trial authority expired or changed.');
    };
    const assertCurrent = () => {
      assertClock();
      const state = this.journal.state,
        current = jobs.read(initial.intent.id),
        actual = processIdentity(identity.pid, identity.token);
      if (
        this.closing ||
        this.child !== child ||
        !child.connected ||
        this.childChannelFailed ||
        state.phase !== 'starting' ||
        state.generationId !== attempt.generationId ||
        state.epoch !== attempt.epoch ||
        state.instanceId !== initial.intent.target.instanceId ||
        state.restoreJob?.jobId !== initial.intent.id ||
        state.restoreJob.intentHash !== initial.intentHash ||
        !state.child ||
        !actual ||
        ['pid', 'start', 'boot', 'token'].some(
          (key) =>
            state.child![key as keyof ProcessIdentity] !== identity[key as keyof ProcessIdentity] ||
            actual[key as keyof ProcessIdentity] !== identity[key as keyof ProcessIdentity],
        ) ||
        state.operation?.id !== operation.id ||
        state.operation.generationId !== attempt.generationId ||
        state.operation.actorId !== operation.actorId ||
        state.operation.sessionHash !== operation.sessionHash ||
        state.operation.expiresAt !== operation.expiresAt ||
        state.operation.tokenHash !== operation.tokenHash ||
        !current ||
        current.phase !== record.phase ||
        !(
          original
            ? ['original-trial-planned', 'original-trial-opening']
            : ['trial-planned', 'trial-opening']
        ).includes(current.phase) ||
        current.revision !== record.revision ||
        current.intentHash !== initial.intentHash ||
        JSON.stringify(selectedRestoreTrial(current)) !== JSON.stringify(permit)
      )
        throw new Error('Restore trial lost its durable process binding.');
      this.assertGeneration();
      assertClock();
    };
    const ready = new Promise<void>((resolve, reject) => {
      this.restoreTrialWaiter = { permit, assertCurrent, resolve, reject };
    });
    void ready.catch(() => {});
    const abort = () =>
      this.restoreTrialWaiter?.reject(new Error('Restore trial was interrupted.'));
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => this.restoreTrialWaiter?.reject(new Error('Restore trial readiness timed out.')),
      Math.max(1, permit.deadline - Date.now()),
    );
    try {
      // The job owns the selected process before any handle can authorize a DB
      // open. The main generation, epoch and operation move in one journal write.
      record = jobs[original ? 'planOriginalTrial' : 'planTrial'](
        initial.intent.id,
        initial.intentHash,
        record.revision,
        permit,
      );
      signal.throwIfAborted();
      this.transition({
        phase: 'starting',
        child: identity,
        generationId: attempt.generationId,
        epoch: attempt.epoch,
        operation: { ...operation, generationId: attempt.generationId },
        verifiedAt: null,
        lastFailure: null,
      });
      assertCurrent();
      record = jobs[original ? 'markOriginalTrialOpening' : 'markTrialOpening'](
        initial.intent.id,
        initial.intentHash,
        record.revision,
      );
      assertCurrent();
      await Promise.all([
        ready,
        shareWorkspaceOwnership(
          child,
          this.journal.workspaceOwnership(),
          Math.max(1, permit.deadline - Date.now()),
          { permit, assertCurrent },
        ).then(() => {
          assertCurrent();
          this.childOwned = true;
        }),
      ]);
      assertCurrent();
      if (!this.childOwned) throw new Error('Restore trial ownership was not acknowledged.');
      record = jobs[original ? 'markOriginalTrialReady' : 'markTrialReady'](
        initial.intent.id,
        initial.intentHash,
        record.revision,
        restoreTrialReference(permit),
        permit.output.fingerprint,
      );
      signal.throwIfAborted();
      if (Date.now() >= permit.deadline) throw new Error('Restore trial readiness expired.');
      this.transition({ phase: 'paused', verifiedAt: null });
      return record;
    } catch (error) {
      let witnessedFailure: RestoreJobRecord | undefined;
      clearTimeout(timer);
      this.restoreTrialWaiter = undefined;
      try {
        if (record.phase === 'trial-opening' || record.phase === 'trial-ready')
          witnessedFailure = await this.stopFailedRestoreTrialOwned(jobs, record);
      } catch {
        // Without its independent final witness this attempt remains unusable
        // for rollback reconciliation. Retain every durable boundary reached.
      }
      this.failure('restore-trial-failed');
      try {
        // Any eligible final-witness attempt has finished. An unusable private
        // trial gets no new TERM grace, including after a slow failure write.
        await this.stopGroup(identity, true, true);
        this.child = undefined;
        this.childOwned = false;
        this.transition({ child: null });
      } catch {
        // Retain the exact selected identity and barrier for restart recovery.
      }
      if (witnessedFailure) throw new WitnessedRestoreTrialFailure(error, witnessedFailure);
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      this.restoreTrialWaiter = undefined;
    }
  }
  private async stopFailedRestoreTrialOwned(jobs: RestoreJobs, initial: RestoreJobRecord) {
    const permit = initial.execution?.trial,
      child = this.child;
    if (
      this.closing ||
      !permit ||
      !['trial-opening', 'trial-ready'].includes(initial.phase) ||
      !child?.connected ||
      this.childChannelFailed ||
      this.childReady
    )
      throw new Error('The failed restore trial cannot provide final evidence.');
    let record = initial;
    const stop: RestoreTrialStopRequest = {
      reference: restoreTrialReference(permit),
      child: structuredClone(permit.child),
      request: {
        jobId: initial.intent.id,
        generationId: permit.generationId,
        epoch: permit.epoch,
        challengeId: randomUUID(),
        deadline: this.now() + RESTORE_TRIAL_STOP_MS,
      },
    };
    const assertCurrent = () => {
      const current = jobs.read(initial.intent.id),
        state = this.journal.state,
        actual = processIdentity(permit.child.pid, permit.child.token);
      if (
        this.closing ||
        this.child !== child ||
        !child.connected ||
        this.childChannelFailed ||
        state.phase !== 'stopping' ||
        state.generationId !== permit.generationId ||
        state.epoch !== permit.epoch ||
        !state.child ||
        !actual ||
        ['pid', 'start', 'boot', 'token'].some(
          (key) =>
            state.child![key as keyof ProcessIdentity] !==
              permit.child[key as keyof ProcessIdentity] ||
            actual[key as keyof ProcessIdentity] !== permit.child[key as keyof ProcessIdentity],
        ) ||
        !current ||
        JSON.stringify(current) !== JSON.stringify(record) ||
        this.now() < record.updatedAt ||
        this.now() >= stop.request.deadline
      )
        throw new Error('Failed restore evidence lost its current binding.');
      this.assertGeneration();
      if (this.now() >= stop.request.deadline) throw new Error('Failed restore evidence expired.');
    };
    const witness = new Promise<void>((resolve, reject) => {
      this.restoreTrialStopWaiter = {
        stop,
        accepted: false,
        resolve,
        reject,
        assertCurrent,
        accept: (fingerprint) => {
          record = jobs.acceptTrialWitness(
            initial.intent.id,
            initial.intentHash,
            record.revision,
            stop,
            fingerprint,
          );
        },
      };
    });
    void witness.catch(() => {});
    const waiter = this.restoreTrialStopWaiter!;
    const timer = setTimeout(
      () => waiter.reject(new Error('Failed restore shutdown timed out.')),
      RESTORE_TRIAL_STOP_MS,
    );
    const memory = this.watchRestoreShutdown(permit.child, () =>
      waiter.reject(new Error('Failed restore shutdown exceeded its memory budget.')),
    );
    try {
      // Original witness remains in the main journal. This distinct challenge
      // must be durable in the selected job before its private IPC dispatch.
      this.transition({ phase: 'stopping', verifiedAt: null });
      record = jobs.planTrialStop(initial.intent.id, initial.intentHash, record.revision, stop);
      assertCurrent();
      child.send({ channel: MAINTENANCE_CHANNEL, kind: 'restore-trial-stop', stop }, (error) => {
        if (error) waiter.reject(new Error('Failed restore shutdown disconnected.'));
      });
      await witness;
      clearTimeout(timer);
      clearInterval(memory);
      await this.stopGroup(permit.child);
      if (this.closing || this.journal.state.phase !== 'stopping' || !waiter.accepted)
        throw new Error('Failed restore shutdown lost its final witness binding.');
      this.child = undefined;
      this.childOwned = false;
      this.transition({ phase: 'stopped', child: null, verifiedAt: null });
      record = jobs.markTrialStopped(initial.intent.id, initial.intentHash, record.revision);
      return await this.retainFailedRestoreTrialOwned(jobs, record);
    } finally {
      clearTimeout(timer);
      clearInterval(memory);
      this.restoreTrialStopWaiter = undefined;
    }
  }
  /** Negative evidence only: this cannot refresh the original proof or select
   * rollback content. One recorded deadline covers custody and failed freezing. */
  private async retainFailedRestoreTrialOwned(jobs: RestoreJobs, initial: RestoreJobRecord) {
    if (
      initial.phase !== 'trial-witnessed-stopped' ||
      !initial.execution?.failure ||
      !initial.execution.trial
    )
      throw new Error('Failed restore has no witnessed closed trial.');
    let record = initial;
    const permit = initial.execution.trial,
      failed = initial.execution.failure.stop;
    const budget = this.options.budgets?.restoreMs ?? 120_000;
    const deadline = Math.min(this.now(), Date.now()) + budget;
    const signal = AbortSignal.any([
      AbortSignal.timeout(budget),
      ...(this.restoreAdmissionAbort ? [this.restoreAdmissionAbort.signal] : []),
    ]);
    const assertBudget = () => {
      signal.throwIfAborted();
      const now = this.now();
      if (now < record.updatedAt || now >= deadline || Date.now() >= deadline)
        throw new Error('Failed restore evidence exceeded its fixed time budget.');
    };
    const assertClosed = () => {
      assertBudget();
      const state = this.journal.state,
        current = jobs.read(initial.intent.id),
        original = initial.execution!.stop!;
      if (
        this.closing ||
        this.child ||
        this.childOwned ||
        this.childReady ||
        state.child ||
        state.phase !== 'stopped' ||
        state.generationId !== permit.generationId ||
        state.epoch !== permit.epoch ||
        state.instanceId !== initial.intent.target.instanceId ||
        state.restoreJob?.jobId !== initial.intent.id ||
        state.restoreJob.intentHash !== initial.intentHash ||
        !sameFile(state.databaseIdentity, initial.intent.target.identity) ||
        !state.restoreStop ||
        JSON.stringify(state.restoreStop) !== JSON.stringify(original) ||
        !current ||
        JSON.stringify(current) !== JSON.stringify(record) ||
        groupMembers(permit.child).length
      )
        throw new Error('Failed restore evidence lost physical closure or its original binding.');
      this.assertGeneration();
      assertWorkspaceHandlesClosed(this.journal.databasePath);
      assertBudget();
    };
    assertClosed();
    record = jobs.planTrialCapture(
      initial.intent.id,
      initial.intentHash,
      record.revision,
      randomUUID(),
      deadline,
    );
    const custody = {
      root: this.journal.root,
      databasePath: this.journal.databasePath,
      permit,
      stop: {
        reference: restoreTrialReference(permit),
        child: permit.child,
        request: failed.request,
      },
      witness: { fingerprint: failed.fingerprint!, acceptedAt: failed.acceptedAt! },
      captureId: record.execution!.failure!.capture!.slot,
      now: this.now,
      deadline,
      signal,
      assertClosed,
    };
    const manifest = await captureFailedRestoreCustody(custody);
    assertClosed();
    record = jobs.planTrialCustody(
      initial.intent.id,
      initial.intentHash,
      record.revision,
      manifest,
    );
    await preserveFailedRestoreCustody(custody, record.execution!.failure!.capture!.manifest!);
    assertClosed();
    record = jobs.markTrialCustodyRetained(initial.intent.id, initial.intentHash, record.revision);
    record = jobs.planTrialFreeze(
      initial.intent.id,
      initial.intentHash,
      record.revision,
      randomUUID(),
      deadline,
    );
    const parent = join(this.journal.root, `restore-${initial.intent.id}`),
      stagingRoot = join(parent, `failed-freeze-${record.execution!.failure!.freeze!.slot}`);
    assertClosed();
    mkdirSync(stagingRoot, { mode: 0o700 });
    await syncRestoreDirectory(stagingRoot, signal);
    assertClosed();
    await syncRestoreDirectory(parent, signal);
    assertClosed();
    const frozen = await freezeCurrentRestore({
      ...failedRestoreCustodyInputs(this.journal.root, manifest),
      stagingRoot,
      timeoutMs: Math.max(1, deadline - Date.now()),
      signal,
    });
    // Never dispose a completed failed image on uncertain publication. Its exact
    // directory remains in this one reserved slot for independent recovery.
    await syncRestoreDirectory(stagingRoot, signal);
    assertClosed();
    if (
      dirname(dirname(frozen.databasePath)) !== stagingRoot ||
      basename(frozen.databasePath) !== 'frozen.sqlite'
    )
      throw new Error('Failed frozen output escaped its reserved slot.');
    record = jobs.markTrialFrozen(initial.intent.id, initial.intentHash, record.revision, {
      directory: basename(dirname(frozen.databasePath)),
      bytes: frozen.databaseBytes,
      sha256: frozen.databaseSha256,
      fingerprint: frozen.fingerprint,
    });
    assertClosed();
    return record;
  }
  private async commitRestoreTrialOwned(
    jobs: RestoreJobs,
    initial: RestoreJobRecord,
    signal: AbortSignal,
    deadline: number,
  ) {
    const permit = selectedRestoreTrial(initial),
      child = this.child;
    if (
      !['trial-ready', 'original-trial-ready'].includes(initial.phase) ||
      !permit ||
      !child ||
      !this.childOwned ||
      this.childReady
    )
      throw new Error('Restore has no privately verified candidate to commit.');
    let record = initial,
      referenceCleared = false,
      releaseSent = false;
    const assertClock = () => {
      signal.throwIfAborted();
      const time = this.now();
      if (
        !Number.isSafeInteger(time) ||
        Date.now() >= Math.min(deadline, permit.deadline) ||
        time < Math.max(record.updatedAt, this.journal.state.updatedAt) ||
        time >= initial.intent.authority.expiresAt
      )
        throw new Error('Restore release authority expired or changed.');
    };
    const assertCurrent = () => {
      assertClock();
      const state = this.journal.state,
        current = jobs.read(initial.intent.id),
        identity = processIdentity(permit.child.pid, permit.child.token);
      if (
        this.closing ||
        this.child !== child ||
        !this.childOwned ||
        !child.connected ||
        this.childChannelFailed ||
        state.phase !== 'paused' ||
        state.instanceId !== initial.intent.target.instanceId ||
        state.generationId !== permit.generationId ||
        state.epoch !== permit.epoch ||
        !sameFile(state.databaseIdentity, permit.identity) ||
        !sameFile(this.journal.workspaceOwnership().databaseIdentity, permit.identity) ||
        !state.child ||
        !identity ||
        ['pid', 'start', 'boot', 'token'].some(
          (key) =>
            state.child![key as keyof ProcessIdentity] !==
              permit.child[key as keyof ProcessIdentity] ||
            identity[key as keyof ProcessIdentity] !== permit.child[key as keyof ProcessIdentity],
        ) ||
        state.operation?.id !== initial.intent.id ||
        state.operation.generationId !== permit.generationId ||
        state.operation.actorId !== initial.intent.authority.actorId ||
        state.operation.sessionHash !== initial.intent.authority.sessionHash ||
        state.operation.expiresAt !== initial.intent.authority.expiresAt ||
        state.operation.tokenHash !== initial.intent.continuationHash ||
        (referenceCleared
          ? state.restoreJob !== null
          : state.restoreJob?.jobId !== initial.intent.id ||
            state.restoreJob.intentHash !== initial.intentHash) ||
        !current ||
        current.intentHash !== record.intentHash ||
        current.revision !== record.revision ||
        current.phase !== record.phase ||
        JSON.stringify(current.execution) !== JSON.stringify(record.execution)
      )
        throw new Error('Restore candidate commitment lost its selected process.');
      this.assertGeneration();
      if (referenceCleared) {
        if (!isCommittedRestoreJob(current) || state.restoreStop || state.verifiedAt === null)
          throw new Error('Restore terminal selection is incomplete.');
        assertNoPendingRestore(this.journal.databasePath);
      }
      assertClock();
    };
    const released = new Promise<void>((resolve, reject) => {
      this.restoreReleaseWaiter = {
        permit,
        assertCurrent: () => {
          if (!releaseSent || !referenceCleared || !isCommittedRestoreJob(record))
            throw new Error('Restore release has not been durably authorized.');
          assertCurrent();
        },
        resolve,
        reject,
      };
    });
    void released.catch(() => {});
    const abort = () =>
      this.restoreReleaseWaiter?.reject(new Error('Restore release was interrupted.'));
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () =>
        this.restoreReleaseWaiter?.reject(new Error('Restore release acknowledgement timed out.')),
      Math.max(1, Math.min(deadline, permit.deadline) - Date.now()),
    );
    try {
      assertCurrent();
      await commitRestoreFiles(
        {
          root: this.journal.root,
          databasePath: this.journal.databasePath,
          signal,
          deadline,
          // Commit only removes a barrier after selecting an outcome. Its caller
          // verifies the one live, gated trial; no database bytes are overwritten.
          assertClosed: () => {
            throw new Error('A live trial cannot authorize file replacement.');
          },
          readPhase: () => {
            assertCurrent();
            if (record.phase === 'trial-ready') return 'activated';
            if (record.phase === 'original-trial-ready') return 'rolled-back';
            if (isCommittedRestoreJob(record))
              return permit.role === 'candidate' ? 'candidate-committed' : 'original-committed';
            throw new Error('Restore has no eligible terminal decision.');
          },
          persist: async (phase) => {
            assertCurrent();
            if (
              phase !== (permit.role === 'candidate' ? 'candidate-committed' : 'original-committed')
            )
              throw new Error('Restore outcome changed.');
            record = jobs[
              permit.role === 'candidate' ? 'markCandidateCommitted' : 'markOriginalCommitted'
            ](
              initial.intent.id,
              initial.intentHash,
              record.revision,
              restoreTrialReference(permit),
            );
            // The immutable winner is now durable. A later error can keep this
            // generation closed, but can never select the original instead.
            this.transition({ restoreStop: null, verifiedAt: this.now() });
            assertCurrent();
          },
        },
        {
          ...initial.execution!.originals!,
          candidate: { bytes: permit.output.bytes, sha256: permit.output.sha256 },
        },
        permit.role,
      );
      assertCurrent();
      assertNoPendingRestore(this.journal.databasePath);
      this.transition({ restoreJob: null });
      referenceCleared = true;
      assertCurrent();
      this.journal.assertNoPendingRestoreJobs();
      assertCurrent();
      releaseSent = true;
      this.sendChild(child, {
        channel: MAINTENANCE_CHANNEL,
        kind: 'restore-trial-release',
        reference: restoreTrialReference(permit),
      });
      await released;
      assertCurrent();
      this.childReady = true;
      await this.resume(assertCurrent, assertClock);
      return record;
    } catch (error) {
      let witnessedFailure: RestoreJobRecord | undefined;
      clearTimeout(timer);
      this.restoreReleaseWaiter = undefined;
      try {
        if (record.phase === 'trial-ready')
          witnessedFailure = await this.stopFailedRestoreTrialOwned(jobs, record);
      } catch {
        // A published candidate winner must never enter this failure branch.
      }
      this.failure('restore-release-failed');
      try {
        // After any eligible final-evidence attempt, contain the failed private
        // process immediately while retaining the physical-closure proof.
        await this.stopGroup(permit.child, true, true);
        this.child = undefined;
        this.childOwned = false;
        this.transition({ child: null });
      } catch {
        // The recorded selected process remains available to restart recovery.
      }
      if (witnessedFailure) throw new WitnessedRestoreTrialFailure(error, witnessedFailure);
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      this.restoreReleaseWaiter = undefined;
    }
  }
  private launchApplicationChild(trial = false) {
    this.childReady = false;
    this.childOwned = false;
    this.childReadyEpoch = undefined;
    const groupToken = randomUUID();
    const environment = {
      ...this.applicationEnvironment(),
      DATABASE_PATH: this.journal.databasePath,
      SPINEL_SUPERVISED: '1',
      SPINEL_PROCESS_GROUP_TOKEN: groupToken,
      ...(trial ? { SPINEL_RESTORE_TRIAL: '1' } : {}),
    };
    const child =
      this.options.createChild?.(groupToken, environment) ??
      fork(
        fileURLToPath(new URL('../../../server/index.ts', import.meta.url)),
        this.options.development ? ['--dev', '--no-open'] : [],
        {
          env: environment,
          execArgv: [
            '--max-old-space-size=256',
            '--max-semi-space-size=8',
            ...(this.options.development ? ['--no-turbo-fast-api-calls'] : []),
          ],
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
          detached: true,
        },
      );
    this.child = child;
    this.childChannelFailed = false;
    child.on('message', (value) => {
      void this.childMessage(child, value);
    });
    child.on('error', () => this.childControlFailed(child, 'start-failed'));
    child.once('exit', () => {
      if (this.child !== child) return;
      this.restoreWaiter?.reject(
        new Error('The application exited before restore shutdown completed.'),
      );
      this.restoreTrialWaiter?.reject(new Error('The restore trial application exited.'));
      this.restoreTrialStopWaiter?.reject(
        new Error('The failed trial exited before its final witness.'),
      );
      this.restoreReleaseWaiter?.reject(
        new Error('The restore application exited before release.'),
      );
      this.childReady = false;
      this.childOwned = false;
      if (!['stopping', 'stopped'].includes(this.journal.state.phase) && !this.closing)
        this.failure('application-stopped');
    });
    const identity = child.pid ? processIdentity(child.pid, groupToken) : null;
    if (!identity) {
      this.failure('start-failed');
      throw new Error('Application process did not start.');
    }
    return { child, identity };
  }
  private async start() {
    this.journal.assertNoPendingRestoreJobs();
    if (this.journal.state.restoreStop)
      throw new Error(
        'An unfinished restore witness must be reconciled before application restart.',
      );
    assertNoPendingRestore(this.journal.databasePath);
    if (this.journal.state.phase !== 'stopped' || this.journal.state.verifiedAt === null)
      throw new Error('Verify the closed workspace before starting it.');
    this.assertGeneration();
    await this.journal.bindWorkspace();
    this.journal.assertNoPendingRestoreJobs();
    assertWorkspaceHandlesClosed(this.journal.databasePath);
    this.transition({ phase: 'starting', lastFailure: null });
    const { child, identity } = this.launchApplicationChild();
    const started = new Promise<void>((resolve, reject) => {
      this.startWaiter = { resolve, reject };
    });
    // A synchronous persistence failure below can reject this before the
    // handoff/start aggregate is installed; its catch still reports the failure.
    void started.catch(() => {});
    const timer = setTimeout(
      () => this.failure('start-timeout'),
      this.options.budgets?.startMs ?? START_MS,
    );
    try {
      // Durable process identity precedes every transferable handle. Either
      // parent can die mid-handoff without admitting an unowned DB open.
      this.transition({ child: identity });
      await Promise.all([
        started,
        shareWorkspaceOwnership(
          child,
          this.journal.workspaceOwnership(),
          this.options.budgets?.startMs ?? START_MS,
        ).then(() => {
          this.childOwned = true;
          this.acceptChildReady();
        }),
      ]);
    } catch (error) {
      this.failure('start-failed');
      await this.stopGroup(identity).catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
      this.startWaiter = undefined;
    }
  }
  private acceptChildReady() {
    if (
      this.journal.state.restoreJob ||
      !this.childOwned ||
      this.childReadyEpoch !== this.journal.state.epoch ||
      this.journal.state.phase !== 'starting'
    )
      return;
    this.assertGeneration();
    this.childReady = true;
    this.transition({ phase: 'paused' });
    this.startWaiter?.resolve();
  }
  private observeRestore(child: ChildProcess, id?: string): RestoreObservation {
    const initial = this.journal.state;
    const identity = initial.child ? { ...initial.child } : null;
    const target = { generationId: initial.generationId, epoch: initial.epoch };
    const assertSelected = () => {
      const state = this.journal.state;
      if (
        this.closing ||
        child !== this.child ||
        !child.connected ||
        !this.childOwned ||
        !this.childReady ||
        state.phase !== 'running' ||
        this.restoreTrialWaiter ||
        this.restoreReleaseWaiter ||
        !identity ||
        !state.child ||
        child.pid !== identity.pid ||
        state.child.pid !== identity.pid ||
        state.child.start !== identity.start ||
        state.child.boot !== identity.boot ||
        state.child.token !== identity.token ||
        state.generationId !== target.generationId ||
        state.epoch !== target.epoch
      )
        throw new Error(RESTORE_RPC_ERROR);
      this.journal.checkRoot();
      this.assertGeneration();
    };
    assertSelected();
    const jobs = new RestoreJobs(this.journal, this.now);
    try {
      // Complete validation is essential: a truncated/unreadable inventory must
      // never be presented as missing evidence or permission to drop a lease.
      const records = jobs.list();
      const reference = this.journal.state.restoreJob;
      if (
        reference &&
        !records.some(
          (record) =>
            record.intent.id === reference.jobId && record.intentHash === reference.intentHash,
        )
      )
        throw new Error(RESTORE_RPC_ERROR);
      const preferred = id ?? reference?.jobId ?? this.journal.state.completedOperationId;
      let record = records.find((item) => item.intent.id === preferred) ?? null;
      if (!id && !record)
        record =
          records.sort(
            (a, b) =>
              b.intent.confirmedAt - a.intent.confirmedAt ||
              b.updatedAt - a.updatedAt ||
              a.intent.id.localeCompare(b.intent.id),
          )[0] ?? null;
      const pending =
        !!reference ||
        !!this.journal.state.restoreStop ||
        this.restoreAdmissions > 0 ||
        !!this.restoreAdmissionAbort ||
        !!this.restoreExecution ||
        [...this.restoreRpcRequests.values()].some(
          (action) => action !== 'restore-observe' && action !== 'restore-estimate',
        ) ||
        records.some((item) => item.phase !== 'failed' && !isCommittedRestoreJob(item));
      assertSelected();
      return { target, record, pending };
    } finally {
      jobs.close();
    }
  }
  /** Read-only estimate for the current application's verified preparation.
   * It cannot pause, retain source, renew authority or authorize an opening. */
  estimatePreparedRestore(request: RestoreCapacityRequest): RestoreCapacityResult {
    const state = this.journal.state;
    const child = this.child;
    const assertCurrent = () => {
      const current = this.journal.state;
      if (
        this.closing ||
        !child?.connected ||
        child !== this.child ||
        !this.childReady ||
        !this.childOwned ||
        current.phase !== 'running' ||
        current.instanceId !== state.instanceId ||
        current.restoreStop ||
        current.generationId !== request.generationId ||
        current.epoch !== request.epoch ||
        !current.child ||
        current.child.pid !== child.pid ||
        !state.child ||
        current.child.start !== state.child.start ||
        current.child.boot !== state.child.boot ||
        current.child.token !== state.child.token ||
        !state.databaseIdentity ||
        !sameFile(current.databaseIdentity, state.databaseIdentity)
      )
        throw new Error(RESTORE_RPC_ERROR);
      this.assertGeneration();
    };
    assertCurrent();
    const resources = estimateRestoreCapacity(
      {
        databasePath: this.journal.databasePath,
        identity: state.databaseIdentity!,
        recoveryRoot: this.journal.root,
        archiveBytes: request.archiveBytes,
        databaseBytes: request.databaseBytes,
        previewDatabaseBytes: request.previewDatabaseBytes,
        sourceRetained: false,
        checkedAt: this.now(),
      },
      this.options.restoreCapacityVolume,
    );
    assertCurrent();
    return { target: { generationId: request.generationId, epoch: request.epoch }, resources };
  }
  private beginCapacityRefusal(error: unknown, child: ChildProcess) {
    if (!(error instanceof RestoreBeginCapacityError)) return;
    const jobs = new RestoreJobs(this.journal, this.now);
    try {
      const record = jobs.read(error.jobId),
        state = this.journal.state;
      if (
        !record ||
        record.phase !== 'source-retained' ||
        record.execution ||
        !error.matches(record, state.child) ||
        this.closing ||
        child !== this.child ||
        !child.connected ||
        !this.childOwned ||
        !this.childReady ||
        state.child?.pid !== child.pid ||
        state.phase !== 'running' ||
        state.restoreStop ||
        state.instanceId !== record.intent.target.instanceId ||
        state.generationId !== record.intent.target.generationId ||
        state.epoch !== record.intent.target.epoch ||
        !sameFile(state.databaseIdentity, record.intent.target.identity) ||
        state.restoreJob?.jobId !== record.intent.id ||
        state.restoreJob.intentHash !== record.intentHash
      )
        return;
      this.assertGeneration();
      const at = this.now();
      if (
        at < record.updatedAt ||
        at < record.intent.authority.verifiedAt ||
        at >= record.intent.authority.expiresAt
      )
        return;
      return { generationId: state.generationId, epoch: state.epoch };
    } finally {
      jobs.close();
    }
  }

  private async restoreRpc(child: ChildProcess, value: Record<string, unknown>) {
    const action = value.kind;
    if (
      action !== 'restore-admit' &&
      action !== 'restore-begin' &&
      action !== 'restore-observe' &&
      action !== 'restore-estimate'
    )
      return;
    const requestId = value.requestId;
    if (typeof requestId !== 'string' || !uuidPattern.test(requestId)) return;
    if (this.restoreRpcRequests.has(requestId)) return;
    const reply = (result?: unknown, capacity?: { generationId: string; epoch: string }) =>
      this.sendChild(child, {
        channel: MAINTENANCE_CHANNEL,
        kind: 'restore-result',
        action: value.kind,
        requestId,
        ...(result === undefined ? { error: RESTORE_RPC_ERROR } : { result }),
        ...(capacity ? { resourceCode: 'disk-space', target: capacity } : {}),
      });
    if (this.restoreRpcRequests.size >= RESTORE_RPC_PENDING) {
      reply();
      return;
    }
    this.restoreRpcRequests.set(requestId, action);
    try {
      const identity = this.journal.state.child;
      if (
        this.closing ||
        child !== this.child ||
        !child.connected ||
        !this.childOwned ||
        !identity ||
        child.pid !== identity.pid ||
        !exact(value, ['channel', 'kind', 'requestId', 'request']) ||
        !boundedRestoreRpc(value) ||
        !object(value.request)
      )
        throw new Error(RESTORE_RPC_ERROR);
      const request = value.request;
      if (value.kind === 'restore-estimate') {
        if (
          !exact(request, [
            'generationId',
            'epoch',
            'archiveBytes',
            'databaseBytes',
            'previewDatabaseBytes',
          ]) ||
          Object.keys(request).length !== 5 ||
          typeof request.generationId !== 'string' ||
          !uuidPattern.test(request.generationId) ||
          typeof request.epoch !== 'string' ||
          !uuidPattern.test(request.epoch)
        )
          throw new Error(RESTORE_RPC_ERROR);
        reply(this.estimatePreparedRestore(request as unknown as RestoreCapacityRequest));
      } else if (value.kind === 'restore-admit') {
        if (
          !exact(request, [
            'id',
            'generationId',
            'epoch',
            'authority',
            'confirmedAt',
            'preview',
            'previewDatabaseBytes',
            'consequenceEnvelope',
            'source',
          ])
        )
          throw new Error(RESTORE_RPC_ERROR);
        const result = await this.admitPreparedRestore(request as unknown as RestoreAdmission);
        reply(result);
      } else if (value.kind === 'restore-begin') {
        if (
          !exact(request, ['id', 'intentHash', 'continuationToken']) ||
          typeof request.id !== 'string' ||
          !uuidPattern.test(request.id) ||
          typeof request.intentHash !== 'string' ||
          !/^[a-f0-9]{64}$/.test(request.intentHash) ||
          typeof request.continuationToken !== 'string' ||
          !/^[A-Za-z0-9_-]{43}$/.test(request.continuationToken)
        )
          throw new Error(RESTORE_RPC_ERROR);
        const jobs = new RestoreJobs(this.journal, this.now);
        try {
          const record = jobs.read(request.id),
            origin = record?.execution?.child;
          // An original HTTP retry can observe durable planning outside the drain
          // queue. A selected private or replacement child cannot continue it.
          if (
            !record ||
            record.intent.target.instanceId !== this.journal.state.instanceId ||
            record.intent.target.generationId !== this.journal.state.generationId ||
            ![record.intent.target.epoch, record.execution?.epoch].includes(
              this.journal.state.epoch,
            ) ||
            this.journal.state.restoreJob?.jobId !== record.intent.id ||
            this.journal.state.restoreJob.intentHash !== record.intentHash ||
            (origin &&
              (origin.pid !== identity.pid ||
                origin.start !== identity.start ||
                origin.boot !== identity.boot ||
                origin.token !== identity.token))
          )
            throw new Error(RESTORE_RPC_ERROR);
        } finally {
          jobs.close();
        }
        const result = await this.beginPreparedRestore({
          id: request.id,
          intentHash: request.intentHash,
          continuationToken: request.continuationToken,
        });
        reply({ record: result.record });
      } else if (value.kind === 'restore-observe') {
        if (
          !exact(request, Object.hasOwn(request, 'id') ? ['id'] : []) ||
          (Object.hasOwn(request, 'id') &&
            (typeof request.id !== 'string' || !uuidPattern.test(request.id)))
        )
          throw new Error(RESTORE_RPC_ERROR);
        // Never join the queue: an admitted HTTP read may itself hold a drain
        // permit. This synchronous observation includes queued mutation work.
        reply(this.observeRestore(child, request.id as string | undefined));
      } else reply();
    } catch (error) {
      // Advice only: a concurrent Begin may have published since the refusal.
      // Recheck its original binding synchronously; uncertainty remains generic.
      let capacity: { generationId: string; epoch: string } | undefined;
      try {
        if (action === 'restore-begin') capacity = this.beginCapacityRefusal(error, child);
      } catch {
        /* An unreadable or changed record cannot establish this refusal. */
      }
      reply(undefined, capacity);
    } finally {
      this.restoreRpcRequests.delete(requestId);
    }
  }
  private async childMessage(child: ChildProcess, value: unknown) {
    if (child !== this.child || !object(value) || value.channel !== MAINTENANCE_CHANNEL) return;
    try {
      if (
        value.kind === 'restore-admit' ||
        value.kind === 'restore-begin' ||
        value.kind === 'restore-observe' ||
        value.kind === 'restore-estimate'
      ) {
        await this.restoreRpc(child, value);
      } else if (
        value.kind === 'restore-trial-witness' ||
        value.kind === 'restore-trial-stop-refused'
      ) {
        const waiter = this.restoreTrialStopWaiter;
        if (
          !waiter ||
          !validRestoreTrialStopRequest(value.stop) ||
          !sameRestoreTrialStopRequest(value.stop, waiter.stop)
        )
          return;
        if (waiter.accepted) {
          if (value.kind !== 'restore-trial-witness' || value.fingerprint !== waiter.fingerprint)
            throw new Error('The failed trial sent conflicting final evidence.');
          return;
        }
        waiter.assertCurrent();
        if (
          value.kind === 'restore-trial-stop-refused' ||
          !exact(value, ['channel', 'kind', 'stop', 'fingerprint']) ||
          !validRestoreFingerprint(value.fingerprint)
        )
          throw new Error('The failed trial refused its final witness.');
        waiter.accept(value.fingerprint);
        waiter.assertCurrent();
        waiter.accepted = true;
        waiter.fingerprint = value.fingerprint;
        this.sendChild(child, {
          channel: MAINTENANCE_CHANNEL,
          kind: 'restore-trial-witness-ack',
          stop: waiter.stop,
          fingerprint: value.fingerprint,
        });
        waiter.resolve();
      } else if (value.kind === 'restore-trial-ready') {
        // Out of band while the controller holds serial(). Private readiness
        // and acknowledgement of all four ownership handles are separate gates.
        const waiter = this.restoreTrialWaiter;
        if (!waiter || !sameRestoreTrialReference(value.reference, waiter.permit)) return;
        waiter.assertCurrent();
        if (
          !exact(value, ['channel', 'kind', 'reference', 'fingerprint']) ||
          value.fingerprint !== waiter.permit.output.fingerprint
        )
          throw new Error('Restore trial readiness changed.');
        waiter.resolve();
      } else if (value.kind === 'restore-trial-released') {
        const waiter = this.restoreReleaseWaiter;
        if (!waiter || !sameRestoreTrialReference(value.reference, waiter.permit)) return;
        waiter.assertCurrent();
        if (!exact(value, ['channel', 'kind', 'reference', 'accepted']) || value.accepted !== true)
          throw new Error('Restore application refused private release.');
        waiter.resolve();
      } else if (value.kind === 'restore-authority-result') {
        // Out of band: the controller owns serial() while awaiting this read.
        const waiter = this.authorityWaiter;
        if (
          !waiter ||
          !validRestoreStopRequest(value.request) ||
          !sameRestoreStopRequest(value.request, waiter.request) ||
          typeof value.accepted !== 'boolean'
        )
          return;
        if (value.accepted) waiter.accept();
        else waiter.reject(new Error('The original restore authorization is no longer valid.'));
      } else if (value.kind === 'restore-witness' || value.kind === 'restore-stop-refused') {
        const record = this.journal.state.restoreStop;
        // Out of band: serial() is already awaiting this witness. The current
        // ChildProcess and full durable challenge are both required.
        if (
          !record ||
          !this.restoreWaiter ||
          !validRestoreStopRequest(value.request) ||
          !sameRestoreStopRequest(value.request, record.request)
        )
          return;
        if (value.kind === 'restore-stop-refused') throw new Error('Restore shutdown was refused.');
        const acceptedAt = this.now();
        if (
          this.closing ||
          this.journal.state.phase !== 'stopping' ||
          this.journal.state.epoch !== record.request.epoch ||
          this.journal.state.generationId !== record.request.generationId ||
          !sameFile(this.journal.state.databaseIdentity, record.databaseIdentity) ||
          !sameFile(fileIdentity(this.journal.databasePath), record.databaseIdentity) ||
          child.pid !== record.child.pid ||
          !this.journal.state.child ||
          this.journal.state.child.start !== record.child.start ||
          this.journal.state.child.boot !== record.child.boot ||
          this.journal.state.child.token !== record.child.token ||
          !validRestoreFingerprint(value.fingerprint) ||
          (record.fingerprint !== null && record.fingerprint !== value.fingerprint)
        )
          throw new Error('Restore witness does not match its current challenge.');
        // Validate conflicts above even after acceptance. A duplicate must not
        // ACK again: the first ACK may already have let the child disconnect.
        if (record.fingerprint !== null) return;
        if (acceptedAt >= record.request.deadline)
          throw new Error('Restore witness arrived after its deadline.');
        const accepted = { ...record, fingerprint: value.fingerprint, acceptedAt };
        this.restoreWitnessCheckpoint?.(accepted);
        this.transition({ restoreStop: accepted });
        // Synchronous fsync may outlast the timer while the event loop is
        // blocked. A persisted witness alone must not bypass this deadline.
        if (this.now() >= record.request.deadline)
          throw new Error('Restore witness persistence exceeded its deadline.');
        // Journal fsync above precedes the one acknowledgement.
        this.sendChild(child, {
          channel: MAINTENANCE_CHANNEL,
          kind: 'restore-witness-ack',
          request: record.request,
          fingerprint: accepted.fingerprint,
        });
        this.restoreWaiter.resolve(accepted);
      } else if (value.kind === 'hello') this.sendState();
      else if (
        value.kind === 'ready' &&
        !this.journal.state.restoreJob &&
        value.epoch === this.journal.state.epoch &&
        this.journal.state.phase === 'starting'
      ) {
        // IPC may deliver held + ready before the sender promise's microtask.
        // Retain readiness until both independent barriers are complete.
        this.childReadyEpoch = value.epoch as string;
        this.acceptChildReady();
      } else if (
        value.kind === 'drained' &&
        value.epoch === this.journal.state.epoch &&
        this.journal.state.phase === 'draining'
      ) {
        this.assertGeneration();
        this.transition({ phase: 'paused' });
        this.drainWaiter?.resolve();
        this.drainWaiter = undefined;
      } else if (value.kind === 'failure')
        this.failure(value.reason === 'drain-failed' ? 'drain-failed' : 'storage-failed');
      else if (
        value.kind === 'command' &&
        typeof value.requestId === 'string' &&
        uuidPattern.test(value.requestId)
      ) {
        const reply = (result?: MaintenanceControlResult, error?: string) => {
          this.sendChild(child, {
            channel: MAINTENANCE_CHANNEL,
            kind: 'result',
            requestId: value.requestId,
            result,
            error,
          });
        };
        try {
          reply(await this.control(value.command));
        } catch (error) {
          reply(undefined, error instanceof Error ? error.message : safeError);
        }
      }
    } catch {
      this.failure('control-failed');
    }
  }
  close(): Promise<void> {
    if (this.closingTask) return this.closingTask;
    if (this.closing) return Promise.resolve();
    this.closing = true;
    this.closingTask = Promise.resolve()
      .then(() => this.closeOwned())
      .finally(() => {
        this.closingTask = undefined;
      });
    return this.closingTask;
  }
  private async closeOwned() {
    this.restoreAdmissionAbort?.abort();
    this.restoreContinuation = undefined;
    clearInterval(this.noticeTimer);
    this.drainWaiter?.reject(new Error('Supervisor is stopping.'));
    this.startWaiter?.reject(new Error('Supervisor is stopping.'));
    this.restoreWaiter?.reject(new Error('Supervisor is stopping.'));
    this.authorityWaiter?.reject(new Error('Supervisor is stopping.'));
    this.restoreTrialStopWaiter?.reject(new Error('Supervisor is stopping.'));
    // Cancellation requests do not settle an in-flight filesystem operation.
    // Retain kernel ownership until every queued action has actually unwound.
    await this.queue;
    let failure: unknown;
    if (this.journal.state.child || this.journal.state.verifier) {
      try {
        this.transition({ phase: 'stopping', verifiedAt: null });
      } catch (error) {
        failure = error;
      }
      const identities = [this.journal.state.verifier, this.journal.state.child].filter(
        (identity): identity is ProcessIdentity => !!identity,
      );
      for (const [index, identity] of identities.entries()) {
        try {
          // The final owned group must witness descriptor teardown within its
          // existing stop budget, just as an explicit stop does. Earlier groups
          // cannot assert closure while the other owned process is still alive.
          await this.stopGroup(identity, index === identities.length - 1);
        } catch (error) {
          failure ??= error;
        }
      }
      try {
        assertWorkspaceHandlesClosed(this.journal.databasePath);
      } catch (error) {
        failure ??= error;
      }
      if (!failure) {
        try {
          this.transition({ phase: 'stopped', child: null, verifier: null });
        } catch (error) {
          failure = error;
        }
      }
      if (failure) this.failure('process-still-active');
    }
    for (const server of [this.controlServer, this.publicServer]) {
      try {
        await closeServer(server);
      } catch (error) {
        failure ??= error;
      }
    }
    try {
      const socket = this.journal.path('control.sock');
      if (lstatSync(socket).isSocket()) unlinkSync(socket);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failure ??= error;
    }
    try {
      await this.journal.close();
    } catch (error) {
      failure ??= error;
    }
    if (failure) throw failure;
  }
}
