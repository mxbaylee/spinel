import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
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
import { fileURLToPath } from 'node:url';
import type {
  MaintenanceAdminStatus,
  MaintenanceAuthority,
  MaintenanceControlResult,
} from '../../shared/maintenance.ts';
import { publicMaintenance } from '../../shared/maintenance.ts';
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
import type { OperationReceipt, ProcessIdentity } from './journal.ts';
import { MAINTENANCE_CHANNEL } from './supervisor-client.ts';
import { shareWorkspaceOwnership } from './ownership.ts';
import { processResourcesReleased, waitForProcessInventory } from './process-exit.ts';

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

interface SupervisorOptions {
  root: string;
  databasePath: string;
  publicPort?: number;
  development?: boolean;
  /** Test seams select real disposable processes; never supplied over a control API. */
  createChild?: (groupToken: string) => ChildProcess;
  now?: () => number;
  budgets?: { drainMs?: number; stopMs?: number; startMs?: number; verifyMs?: number };
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
          if (targets.has(target)) throw new Error('A workspace or WAL handle is still open.');
          const info = statSync(path, { bigint: true });
          if (identities.has(`${info.dev}:${info.ino}`))
            throw new Error('A workspace or WAL handle is still open.');
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

export class MaintenanceSupervisor {
  readonly journal: RecoveryJournal;
  private readonly options: SupervisorOptions;
  private readonly now: () => number;
  private child: ChildProcess | undefined;
  private childReady = false;
  private childOwned = false;
  private childReadyEpoch: string | undefined;
  private drainWaiter: Waiter | undefined;
  private startWaiter: Waiter | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private publicServer: HttpServer | undefined;
  private controlServer: HttpServer | undefined;
  private noticeTimer: ReturnType<typeof setInterval> | undefined;
  private closing = false;
  private constructor(journal: RecoveryJournal, options: SupervisorOptions) {
    this.journal = journal;
    this.options = options;
    this.now = options.now ?? Date.now;
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
  private transition(patch: Partial<typeof this.journal.state>) {
    this.journal.state = { ...this.journal.state, ...patch, updatedAt: this.now() };
    try {
      this.journal.write();
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
  private sendState() {
    if (this.child?.connected)
      this.child.send({ channel: MAINTENANCE_CHANNEL, kind: 'state', status: this.status() });
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
      operationId(command.operationId);
      const state = this.journal.state;
      if (state.completedOperationId === command.operationId)
        throw new Error('This operation has already completed.');
      if (state.operation && state.operation.id !== command.operationId)
        throw new Error('Use the exact current operation ID from status.');
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
      } else if (command.action === 'stop') await this.stop();
      else if (command.action === 'verify') await this.verify();
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
  ) {
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
      epoch: randomUUID(),
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
  private async resume() {
    this.assertGeneration();
    if (
      !this.childReady ||
      this.journal.state.phase !== 'paused' ||
      this.journal.state.verifiedAt === null
    )
      throw new Error('Verify and start the current generation under maintenance before resuming.');
    const completedOperationId = this.journal.state.operation?.id ?? null;
    this.transition({ phase: 'running', operation: null, completedOperationId, lastFailure: null });
  }
  private async stopGroup(identity: ProcessIdentity, checkHandles = true) {
    const deadline = Date.now() + (this.options.budgets?.stopMs ?? STOP_MS);
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
      signal('SIGTERM');
      while ((await members()).length && Date.now() < deadline) await delay(25);
      if ((await members()).length) {
        signal('SIGKILL');
        while ((await members()).length && Date.now() < closedDeadline) await delay(25);
      }
      if ((await members()).length) throw new Error('Application processes are still running.');
    }
    if (checkHandles)
      await waitForProcessInventory(
        () => assertWorkspaceHandlesClosed(this.journal.databasePath),
        closedDeadline,
      );
  }
  private async stop() {
    if (this.journal.state.phase === 'running' || this.journal.state.phase === 'draining')
      throw new Error('Pause and drain accepted work before stopping the application.');
    const identity = this.journal.state.child;
    this.childReady = false;
    this.transition({ phase: 'stopping' });
    try {
      if (identity) await this.stopGroup(identity);
      else assertWorkspaceHandlesClosed(this.journal.databasePath);
      this.child = undefined;
      this.transition({ phase: 'stopped', child: null, verifiedAt: null });
    } catch (error) {
      this.failure('process-still-active');
      throw error;
    }
  }
  private async verify() {
    if (
      this.childReady ||
      this.child?.exitCode === null ||
      (this.journal.state.child && groupMembers(this.journal.state.child).length)
    )
      throw new Error('Stop the application before verifying its closed workspace.');
    await this.journal.bindWorkspace();
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
  private async start() {
    if (this.journal.state.phase !== 'stopped' || this.journal.state.verifiedAt === null)
      throw new Error('Verify the closed workspace before starting it.');
    this.assertGeneration();
    await this.journal.bindWorkspace();
    assertWorkspaceHandlesClosed(this.journal.databasePath);
    this.transition({ phase: 'starting', lastFailure: null });
    this.childReady = false;
    this.childOwned = false;
    this.childReadyEpoch = undefined;
    const groupToken = randomUUID();
    const child =
      this.options.createChild?.(groupToken) ??
      fork(
        fileURLToPath(new URL('../../../server/index.ts', import.meta.url)),
        this.options.development ? ['--dev', '--no-open'] : [],
        {
          env: {
            ...childEnvironment(),
            DATABASE_PATH: this.journal.databasePath,
            SPINEL_SUPERVISED: '1',
            SPINEL_PROCESS_GROUP_TOKEN: groupToken,
          },
          execArgv: [
            '--max-old-space-size=256',
            '--max-semi-space-size=8',
            // SPN-117 also applies when this child serves Vite development responses.
            ...(this.options.development ? ['--no-turbo-fast-api-calls'] : []),
          ],
          stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
          detached: true,
        },
      );
    this.child = child;
    const identity = child.pid ? processIdentity(child.pid, groupToken) : null;
    if (!identity) {
      this.failure('start-failed');
      throw new Error('Application process did not start.');
    }
    const started = new Promise<void>((resolve, reject) => {
      this.startWaiter = { resolve, reject };
    });
    // A synchronous persistence failure below can reject this before the
    // handoff/start aggregate is installed; its catch still reports the failure.
    void started.catch(() => {});
    child.on('message', (value) => {
      void this.childMessage(child, value);
    });
    child.once('error', () => {
      if (this.child === child) this.failure('start-failed');
    });
    child.once('exit', () => {
      if (this.child !== child) return;
      this.childReady = false;
      this.childOwned = false;
      if (!['stopping', 'stopped'].includes(this.journal.state.phase) && !this.closing)
        this.failure('application-stopped');
    });
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
  private async childMessage(child: ChildProcess, value: unknown) {
    if (child !== this.child || !object(value) || value.channel !== MAINTENANCE_CHANNEL) return;
    try {
      if (value.kind === 'hello') this.sendState();
      else if (
        value.kind === 'ready' &&
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
          if (child.connected)
            child.send({
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
  async close() {
    if (this.closing) return;
    this.closing = true;
    clearInterval(this.noticeTimer);
    this.drainWaiter?.reject(new Error('Supervisor is stopping.'));
    this.startWaiter?.reject(new Error('Supervisor is stopping.'));
    let failure: unknown;
    if (this.journal.state.child || this.journal.state.verifier) {
      try {
        this.transition({ phase: 'stopping', verifiedAt: null });
      } catch (error) {
        failure = error;
      }
      for (const identity of [this.journal.state.verifier, this.journal.state.child]) {
        if (!identity) continue;
        try {
          await this.stopGroup(identity, false);
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
