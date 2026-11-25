import { NativeReplica } from '@spinel/sync-client';
import type { DiagnosticSource } from '@spinel/diagnostics';
import { attachSpinelSync } from '../spinelSync.ts';
import { OfflineSession } from './OfflineSession.ts';
import { reserveOfflineReplay } from './offlineStore.ts';
import { offlineReplayAdmission } from './replayAdmission.ts';
import type { OfflineDownload } from './offlineStore.ts';

/** How long a stopped replay may finish saving before it yields to the editor. */
const REPLAY_YIELD_MS = 2_000;

/** One bounded job. Its promise includes persistence, native disposal and writer release. */
export function replayOfflineItem(
  accountId: string,
  download: OfflineDownload,
  current: () => boolean,
  diagnostics?: DiagnosticSource,
) {
  const end = Promise.withResolvers<void>();
  const completed = Promise.withResolvers<void>();
  let requestedStop = false;
  let yieldTimer: ReturnType<typeof setTimeout> | undefined;
  let yielding = false;
  let binding: ReturnType<typeof attachSpinelSync> | undefined;
  const finish = () => {
    requestedStop = true;
    yielding = false;
    clearTimeout(yieldTimer);
    end.resolve();
  };
  const stop = () => {
    // Any stop (opening the editor, which asks twice: once from the file list and once from
    // editor admission) must not cut off a replay that already holds a durable queue. The
    // server may have accepted its request while the acknowledgement is still in flight, and
    // cutting it off leaves the editor a stale base for an edit the original already has, so
    // the editor saves a duplicate recovery copy. Let the save settle, boundedly. A repeat
    // stop during the window does not shorten it.
    if (binding && !requestedStop) {
      requestedStop = true;
      yielding = true;
      yieldTimer = setTimeout(finish, REPLAY_YIELD_MS);
    } else if (!yielding) finish();
    return completed.promise;
  };
  const reservation = reserveOfflineReplay(accountId, download.itemId, stop);
  if (!reservation) return { stop: async () => {}, done: Promise.resolve() };
  let native: NativeReplica | undefined;
  let session: OfflineSession | undefined;
  // A stalled network must not keep the nonvisual native pair alive indefinitely.
  const timeout = setTimeout(finish, 30_000);
  const done = offlineReplayAdmission()
    .replay(accountId, download.itemId, stop, async () => {
      try {
        if (!current() || requestedStop) return;
        session = new OfflineSession(accountId, download.itemId, download.spaceId, current, true);
        await session.activate();
        if (!current() || requestedStop || session.readOnly || !session.pending || session.creation)
          return;
        const bundle = session.bundle;
        const initial = session.initial();
        if (!bundle || !initial) return;
        native = new NativeReplica(session.toVisible(initial.snapshot), bundle.kind);
        binding = attachSpinelSync(
          {
            univer: native.univer,
            unitId: bundle.unitId,
            itemId: download.itemId,
            spaceId: download.spaceId,
            access: bundle.access,
            kind: bundle.kind,
            signal: new AbortController().signal,
            isCurrent: current,
            offline: session,
            diagnostics,
            // Retain attention for the existing visible recovery entry. Background
            // replay must not create a recovery copy or navigate a hidden editor.
            canRefresh: () => false,
            reload: finish,
            lock: finish,
          },
          initial.snapshot,
          initial.revision,
        );
        binding.watch({
          publish(state) {
            if (state.local === 'synced' || state.failed) finish();
          },
          connection() {},
          async readonly() {
            finish();
          },
        });
        await end.promise;
      } finally {
        clearTimeout(timeout);
        clearTimeout(yieldTimer);
        // stop() quiets transport before joining persistence. Even if authority
        // ended or disk failed, disposal fences callbacks and keeps the old queue.
        try {
          await binding?.stop();
        } finally {
          try {
            binding?.dispose();
          } finally {
            try {
              session?.dispose();
            } finally {
              try {
                native?.dispose();
              } finally {
                reservation();
                completed.resolve();
              }
            }
          }
        }
      }
    })
    .finally(() => {
      // A foreground reservation may refuse the shared gate before work starts.
      clearTimeout(timeout);
      reservation();
      completed.resolve();
    });
  return { stop, done };
}
