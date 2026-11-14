import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Server } from 'node:net';
import {
  canonicalDatabasePath,
  fileIdentity,
  sameFile,
  uuidPattern,
  workspaceOwnershipAddresses,
  workspaceOwnershipRoles,
} from './journal.ts';
import type { WorkspaceOwnership, WorkspaceOwnershipRole } from './journal.ts';
import { assertNoPendingRestore } from './restore-barrier.ts';
import {
  assertRestoreTrialBinding,
  assertRestoreTrialTarget,
  registerRestoreOpening,
  validRestoreTrialPermit,
} from './restore-trial.ts';
import type { RestoreOpening, RestoreTrialPermit } from './restore-trial.ts';

export const OWNERSHIP_CHANNEL = 'spinel-workspace-ownership';
const HANDOFF_MS = 10_000;
const heldServers = new Set<Server>();
let inherited: WorkspaceOwnership | undefined;

type HandoffProgress =
  | {
      side: 'sender';
      offerCallback: boolean;
      requestReceived: boolean;
      handleCallbacks: number;
      heldReceived: boolean;
    }
  | {
      side: 'receiver';
      offerReceived: boolean;
      requestCallback: boolean;
      handlesReceived: number;
      heldSent: boolean;
      heldCallback: boolean;
    };

class HandoffFailure extends Error {
  readonly ownershipHandoff: Readonly<HandoffProgress>;
  constructor(error: Error, progress: HandoffProgress) {
    // Keep the original error/message; only fixed counters and flags supplement
    // internal stderr. No path, identity, nonce, authority or IPC payload is copied.
    super(error.message, { cause: error });
    this.ownershipHandoff = Object.freeze({ ...progress });
  }
}

export function ownershipFailureDetails(error: unknown) {
  return error instanceof HandoffFailure ? error.ownershipHandoff : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Copies the same kernel listeners; neither this process nor a receiver gives
 * up its hold. A send callback is not receipt: wait for the child's complete ack.
 */
export function shareWorkspaceOwnership(
  child: ChildProcess,
  ownership: WorkspaceOwnership,
  timeoutMs = HANDOFF_MS,
  restore?: { permit: RestoreTrialPermit; assertCurrent(): void },
): Promise<void> {
  if (restore !== undefined && (!restore || !validRestoreTrialPermit(restore.permit)))
    throw new Error('Invalid restore ownership authorization.');
  const transferId = randomUUID();
  const trial = restore ? structuredClone(restore.permit) : undefined;
  const assertOpening = () => {
    if (!trial) {
      assertNoPendingRestore(ownership.databasePath);
      return;
    }
    restore!.assertCurrent();
    assertRestoreTrialBinding(trial, ownership, child.pid ?? 0);
    restore!.assertCurrent();
  };
  const addresses = workspaceOwnershipAddresses(ownership.databasePath, ownership.databaseIdentity);
  return new Promise<void>((resolve, reject) => {
    assertOpening();
    const progress: Extract<HandoffProgress, { side: 'sender' }> = {
      side: 'sender',
      offerCallback: false,
      requestReceived: false,
      handleCallbacks: 0,
      heldReceived: false,
    };
    let sending = false;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off('message', onMessage);
      child.off('error', failed);
      child.off('exit', failed);
      child.off('disconnect', failed);
      if (error) reject(new HandoffFailure(error, progress));
      else resolve();
    };
    const failed = () => finish(new Error('Workspace ownership handoff was interrupted.'));
    const timer = setTimeout(
      () => finish(new Error('Workspace ownership handoff timed out.')),
      timeoutMs,
    );
    const send = (message: Record<string, unknown>, handle?: Server) =>
      new Promise<void>((resolveSend, rejectSend) => {
        if (settled || !child.connected) {
          rejectSend(new Error('Workspace ownership channel is unavailable.'));
          return;
        }
        child.send({ channel: OWNERSHIP_CHANNEL, ...message }, handle, (error) => {
          if (error) rejectSend(error);
          else {
            if (message.kind === 'offer') progress.offerCallback = true;
            if (message.kind === 'handle') progress.handleCallbacks++;
            resolveSend();
          }
        });
      });
    const sendHandles = async () => {
      for (const role of workspaceOwnershipRoles) {
        assertOpening();
        const handle = ownership.handles[role];
        if (
          !handle.listening ||
          !sameFile(ownership.databaseIdentity, fileIdentity(ownership.databasePath))
        )
          throw new Error('Workspace changed before ownership handoff.');
        await send(
          {
            kind: 'handle',
            transferId,
            role,
            databasePath: ownership.databasePath,
            databaseIdentity: ownership.databaseIdentity,
            addresses,
            ...(trial ? { trial } : {}),
          },
          handle,
        );
      }
    };
    function onMessage(value: unknown) {
      if (!record(value) || value.channel !== OWNERSHIP_CHANNEL) return;
      if (value.kind === 'request' && !sending) {
        progress.requestReceived = true;
        sending = true;
        void sendHandles().catch((error: Error) => finish(error));
      } else if (
        value.kind === 'held' &&
        value.transferId === transferId &&
        sending &&
        value.trialNonce === trial?.nonce
      ) {
        progress.heldReceived = true;
        try {
          assertOpening();
          finish();
        } catch {
          failed();
        }
      } else if (value.kind === 'refused') failed();
    }
    child.on('message', onMessage);
    child.once('error', failed);
    child.once('exit', failed);
    child.once('disconnect', failed);
    // Covers either ordering of parent setup and the receiver's first request.
    void send({ kind: 'offer', ...(trial ? { trial } : {}) }).catch((error: Error) =>
      finish(error),
    );
  });
}

/** No caller may open SQLite until all four inherited listeners are held.
 * These listeners intentionally have no release API: native SQLite descriptors
 * can outlive db.close(), so ownership ends only when this process exits.
 */
export async function receiveWorkspaceOwnership(
  databasePath: string,
  onRestoreOpening?: (opening: RestoreOpening) => void,
): Promise<WorkspaceOwnership> {
  if (!process.send || !process.connected)
    throw new Error('A private workspace ownership channel is required.');
  const canonical = canonicalDatabasePath(databasePath);
  if (!onRestoreOpening) assertNoPendingRestore(canonical);
  const identity = fileIdentity(canonical);
  if (inherited) {
    assertNoPendingRestore(canonical);
    if (inherited.databasePath !== canonical || !sameFile(inherited.databaseIdentity, identity))
      throw new Error('Inherited workspace ownership belongs to another generation.');
    return inherited;
  }
  const expected = workspaceOwnershipAddresses(canonical, identity);
  return new Promise<WorkspaceOwnership>((resolve, reject) => {
    const progress: Extract<HandoffProgress, { side: 'receiver' }> = {
      side: 'receiver',
      offerReceived: false,
      requestCallback: false,
      handlesReceived: 0,
      heldSent: false,
      heldCallback: false,
    };
    const handles: Partial<Record<WorkspaceOwnershipRole, Server>> = {};
    let transferId: string | undefined;
    let mode: 'ordinary' | 'trial' | undefined;
    let trial: RestoreTrialPermit | undefined;
    const assertOpening = () => {
      if (trial) assertRestoreTrialTarget(trial, canonical, identity, process.pid);
      else assertNoPendingRestore(canonical);
    };
    let settled = false;
    let complete = false;
    const finish = (error?: Error) => {
      if (settled) return;
      let received: WorkspaceOwnership | undefined;
      if (!error) {
        try {
          assertOpening();
          received = {
            databasePath: canonical,
            databaseIdentity: identity,
            handles: handles as Record<WorkspaceOwnershipRole, Server>,
          };
          if (trial) onRestoreOpening!(registerRestoreOpening(trial, received));
        } catch (failure) {
          error = failure instanceof Error ? failure : new Error('Workspace opening refused.');
        }
      }
      settled = true;
      clearTimeout(timer);
      process.off('message', onMessage);
      process.off('disconnect', disconnected);
      if (error) {
        // Other listeners may already be queued in the IPC channel. They were
        // never accepted and must not keep a failed pre-open receiver alive.
        const discard = (value: unknown, handle: unknown) => {
          if (
            record(value) &&
            value.channel === OWNERSHIP_CHANNEL &&
            value.kind === 'handle' &&
            handle instanceof Server &&
            !heldServers.has(handle)
          ) {
            handle.unref();
            handle.close(() => {});
          }
        };
        if (process.connected) {
          process.on('message', discard);
          process.once('disconnect', () => process.off('message', discard));
        }
        // A failed handoff has never permitted a DB open. Close only the
        // incomplete copies received by this process, preserving parent holds.
        for (const handle of Object.values(handles)) {
          heldServers.delete(handle);
          handle.close();
        }
        reject(new HandoffFailure(error, progress));
      } else {
        inherited = received!;
        resolve(inherited);
      }
    };
    const disconnected = () => finish(new Error('Workspace ownership handoff disconnected.'));
    const timer = setTimeout(
      () => finish(new Error('Workspace ownership handoff timed out.')),
      HANDOFF_MS,
    );
    const send = (message: Record<string, unknown>, done?: () => void) => {
      if (!process.connected) return disconnected();
      process.send!({ channel: OWNERSHIP_CHANNEL, ...message }, (error: Error | null) => {
        if (error) finish(error);
        else {
          if (message.kind === 'request') progress.requestCallback = true;
          if (message.kind === 'held') progress.heldCallback = true;
          done?.();
        }
      });
    };
    function onMessage(value: unknown, handle: unknown) {
      if (!record(value) || value.channel !== OWNERSHIP_CHANNEL) return;
      if (value.kind === 'offer') {
        progress.offerReceived = true;
        if (!complete) send({ kind: 'request' });
        return;
      }
      if (value.kind !== 'handle' || complete) return;
      try {
        if (mode === undefined) {
          if (value.trial !== undefined) {
            if (!onRestoreOpening || !validRestoreTrialPermit(value.trial))
              throw new Error('Invalid restore opening offer.');
            trial = structuredClone(value.trial);
            mode = 'trial';
          } else mode = 'ordinary';
        }
        if (
          (mode === 'trial' && JSON.stringify(value.trial) !== JSON.stringify(trial)) ||
          (mode === 'ordinary' && value.trial !== undefined)
        )
          throw new Error('Restore opening offer changed.');
        assertOpening();
        const role = value.role as WorkspaceOwnershipRole;
        const addresses = value.addresses;
        if (
          !(handle instanceof Server) ||
          !handle.listening ||
          typeof value.transferId !== 'string' ||
          !uuidPattern.test(value.transferId) ||
          (transferId !== undefined && transferId !== value.transferId) ||
          !workspaceOwnershipRoles.includes(role) ||
          handles[role] ||
          value.databasePath !== canonical ||
          !record(value.databaseIdentity) ||
          value.databaseIdentity.device !== identity.device ||
          value.databaseIdentity.inode !== identity.inode ||
          !record(addresses) ||
          Object.keys(addresses).length !== workspaceOwnershipRoles.length ||
          workspaceOwnershipRoles.some((key) => addresses[key] !== expected[key]) ||
          !sameFile(identity, fileIdentity(canonical))
        )
          throw new Error('Invalid workspace ownership handoff.');
        // IPC transfers the listener, not its JS connection callback. Inherited
        // pipe servers do not expose a pathname through server.address(); the
        // exact address manifest is checked against the fixed path and inode.
        handle.on('connection', (socket) => socket.destroy());
        handle.unref();
        heldServers.add(handle);
        handles[role] = handle;
        progress.handlesReceived++;
        transferId = value.transferId;
        if (workspaceOwnershipRoles.every((key) => handles[key])) {
          complete = true;
          progress.heldSent = true;
          send({ kind: 'held', transferId, ...(trial ? { trialNonce: trial.nonce } : {}) }, () =>
            finish(),
          );
        }
      } catch (error) {
        if (handle instanceof Server && !Object.values(handles).includes(handle)) handle.close();
        send({ kind: 'refused' });
        finish(error instanceof Error ? error : new Error('Invalid workspace ownership handoff.'));
      }
    }
    process.on('message', onMessage);
    process.once('disconnect', disconnected);
    send({ kind: 'request' });
  });
}

/** Only fixed workspace-owning descendants use this (e.g. the WAL fixture). */
export function inheritedWorkspaceOwnership(): WorkspaceOwnership {
  if (!inherited) throw new Error('Workspace ownership has not been inherited.');
  return inherited;
}
