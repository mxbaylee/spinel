import { NativeReplica } from '@spinel/sync-client';
import { attachSpinelSync } from '../spinelSync.ts';
import { OfflineSession } from './OfflineSession.ts';
import { reserveOfflineReplay } from './offlineStore.ts';
import type { OfflineDownload } from './offlineStore.ts';

/** One bounded job. Its promise includes persistence, native disposal and writer release. */
export function replayOfflineItem(
  accountId: string,
  download: OfflineDownload,
  current: () => boolean,
) {
  const end = Promise.withResolvers<void>();
  const completed = Promise.withResolvers<void>();
  let requestedStop = false;
  const finish = () => {
    requestedStop = true;
    end.resolve();
  };
  const stop = () => {
    finish();
    return completed.promise;
  };
  const reservation = reserveOfflineReplay(accountId, download.itemId, stop);
  if (!reservation) return { stop: async () => {}, done: Promise.resolve() };
  let native: NativeReplica | undefined;
  let session: OfflineSession | undefined;
  let binding: ReturnType<typeof attachSpinelSync> | undefined;
  // A stalled network must not keep the nonvisual native pair alive indefinitely.
  const timeout = setTimeout(finish, 30_000);
  const done = (async () => {
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
      // stop() quiets transport before joining persistence. Even if authority
      // ended or disk failed, disposal fences callbacks and keeps the old queue.
      try {
        await binding?.stop();
      } finally {
        binding?.dispose();
        session?.dispose();
        native?.dispose();
        reservation();
        completed.resolve();
      }
    }
  })();
  return { stop, done };
}
