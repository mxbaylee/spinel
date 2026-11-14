import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { fileIdentity, workspaceOwnershipRoles } from './journal.ts';
import type { WorkspaceOwnership } from './journal.ts';
import {
  OWNERSHIP_CHANNEL,
  ownershipFailureDetails,
  shareWorkspaceOwnership,
} from './ownership.ts';

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'spinel-handoff-control-')));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const databasePath = join(directory, 'workspace.sqlite');
  await writeFile(databasePath, 'control fixture; never opened as SQLite');
  const handles = {} as WorkspaceOwnership['handles'];
  // Portable control-flow tests only: real listening TCP servers are retained
  // by this process; supervisor.test.ts owns Linux kernel leases and IPC copies.
  for (const role of workspaceOwnershipRoles) {
    const server = createServer();
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    );
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    handles[role] = server;
  }
  const sent: Array<{
    kind: string;
    role?: string;
    transferId?: string;
    callback: (error?: Error) => void;
  }> = [];
  const channel = new EventEmitter();
  const child = Object.assign(channel, {
    connected: true,
    send(
      value: { kind: string; role?: string; transferId?: string },
      _handle: unknown,
      callback: (error?: Error) => void,
    ) {
      sent.push({ ...value, callback });
      return true;
    },
  }) as unknown as ChildProcess;
  const ownership = { databasePath, databaseIdentity: fileIdentity(databasePath), handles };
  const emit = (value: object) => channel.emit('message', { channel: OWNERSHIP_CHANNEL, ...value });
  const assertRetained = () => {
    expect(Object.values(handles).every((handle) => handle.listening)).toBe(true);
    for (const event of ['message', 'error', 'exit', 'disconnect'])
      expect(channel.listenerCount(event)).toBe(0);
  };
  const start = () => {
    const sharing = shareWorkspaceOwnership(child, ownership);
    // A failed test assertion must not strand the handoff timer/listeners or
    // produce a later unhandled rejection while the fixture is being removed.
    void sharing.catch(() => {});
    cleanups.push(async () => {
      channel.emit('disconnect');
      await sharing.catch(() => {});
    });
    return sharing;
  };
  return { channel, sent, ownership, emit, assertRetained, start };
}

test.each(['initial-request', 'offer-response'])(
  'ownership sender waits for the matching complete receipt with %s ordering',
  async (ordering) => {
    const f = await fixture();
    let resolved = false;
    const result = f.start();
    void result.then(
      () => {
        resolved = true;
      },
      () => {},
    );
    if (ordering === 'offer-response') f.sent[0].callback();
    f.emit({ kind: 'request' });
    if (ordering === 'initial-request') f.sent[0].callback();
    for (const [index, role] of workspaceOwnershipRoles.entries()) {
      expect(f.sent[index + 1].role).toBe(role);
      f.sent[index + 1].callback();
      await Promise.resolve();
    }
    // Local send completion and unrelated/wrong-nonce acknowledgements cannot
    // authorize a DB open. Duplicate requests cannot create another transfer.
    f.emit({ kind: 'request' });
    f.emit({ kind: 'held', transferId: randomUUID() });
    f.emit({ kind: 'held', transferId: f.sent[1].transferId, trialNonce: randomUUID() });
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(f.sent).toHaveLength(5);
    f.emit({ kind: 'held', transferId: f.sent[1].transferId });
    await result;
    f.assertRetained();
  },
);

test.each([0, 2])(
  'interruption after %s handle callbacks retains parent holds and a frozen receipt',
  async (count) => {
    const f = await fixture();
    const result = f.start().catch((error) => error);
    f.sent[0].callback();
    if (count) {
      f.emit({ kind: 'request' });
      f.sent[1].callback();
      await Promise.resolve();
      f.sent[2].callback();
    }
    f.channel.emit('disconnect');
    const error = await result;
    expect(error.message).toBe('Workspace ownership handoff was interrupted.');
    const receipt = ownershipFailureDetails(error);
    expect(receipt).toEqual({
      side: 'sender',
      offerCallback: true,
      requestReceived: count > 0,
      handleCallbacks: count,
      heldReceived: false,
    });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(f.sent).toHaveLength(count + 1);
    f.emit({ kind: 'held', transferId: f.sent[1]?.transferId });
    expect(ownershipFailureDetails(error)).toEqual(receipt);
    f.assertRetained();
  },
);

test.each([3, 4])(
  'the unchanged sender deadline after %s callbacks records a missing held receipt',
  async (callbacks) => {
    const f = await fixture();
    vi.useFakeTimers();
    const result = f.start().catch((error) => error);
    f.sent[0].callback();
    f.emit({ kind: 'request' });
    for (let index = 1; index <= callbacks; index++) {
      f.sent[index].callback();
      await Promise.resolve();
    }
    await vi.advanceTimersByTimeAsync(10_000);
    const error = await result;
    expect(error.message).toBe('Workspace ownership handoff timed out.');
    const receipt = {
      side: 'sender',
      offerCallback: true,
      requestReceived: true,
      handleCallbacks: callbacks,
      heldReceived: false,
    };
    expect(ownershipFailureDetails(error)).toEqual(receipt);
    if (callbacks === 3) {
      // The callback can complete after rejection; the retained receipt must keep
      // the first-failure state rather than borrowing the mutable progress object.
      f.sent[4].callback();
      await Promise.resolve();
      expect(ownershipFailureDetails(error)).toEqual(receipt);
    }
    expect(JSON.stringify(ownershipFailureDetails(error))).not.toContain(f.ownership.databasePath);
    expect(ownershipFailureDetails(new Error('unrelated'))).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    f.assertRetained();
  },
);
