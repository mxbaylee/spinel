import { ICommandService, IUniverInstanceService, LocaleService, LocaleType } from '@univerjs/core';
import { expect, test } from 'vitest';
import { createNativeSyncClient, NativeReplica } from '../index.ts';
import type { ClientCheckpoint, ClientFailure, OutgoingFrame, SubmitFrame } from '../index.ts';
import { book, comparable, doc, fixture, turns, wire } from './fixture.ts';

test.each(['sheet', 'doc'] as const)(
  'a nonvisual %s host restores saved native edits and waits for the acknowledged checkpoint commit',
  async (kind) => {
    const f = fixture(kind === 'sheet' ? book() : doc(), kind);
    const base = f.storage.unit.snapshot;
    let saved: ClientCheckpoint | undefined;
    let holdCommit = false;
    const entered = Promise.withResolvers<void>();
    const commit = Promise.withResolvers<void>();
    const failures: ClientFailure[] = [];
    const outgoing: OutgoingFrame[] = [];
    const persist = async (capture: () => ClientCheckpoint) => {
      const checkpoint = structuredClone(capture());
      if (holdCommit && checkpoint.sent === null && checkpoint.buffer.length === 0) {
        entered.resolve();
        await commit.promise;
      }
      saved = checkpoint;
    };
    let live = new NativeReplica(base, kind);
    let sync = createNativeSyncClient({
      univer: live.univer,
      unitId: base.id,
      kind,
      snapshot: base,
      revision: 1,
      persist,
      send: (frame) => outgoing.push(structuredClone(frame)),
      onState() {},
      onResync: (failure) => failures.push(failure),
      batchDelayMs: 100_000,
    });
    try {
      const injector = live.univer.__getInjector();
      injector.get(IUniverInstanceService).focusUnit(base.id);
      injector.get(LocaleService).load({ [LocaleType.EN_US]: {} });
      const command =
        kind === 'sheet' ? 'sheet.command.set-range-values' : 'doc.command.insert-text';
      const params =
        kind === 'sheet'
          ? {
              unitId: base.id,
              subUnitId: 'one',
              range: { startRow: 3, endRow: 3, startColumn: 2, endColumn: 2 },
              value: { v: 'saved while offline' },
            }
          : {
              unitId: base.id,
              segmentId: '',
              range: { startOffset: 2, endOffset: 2, collapsed: true },
              body: { dataStream: 'saved while offline' },
              debounce: false,
            };
      expect(await injector.get(ICommandService).executeCommand(command, params)).toBe(true);
      await sync.persistNow();
      const expected = comparable(live.snapshot());
      expect(JSON.stringify(expected)).toContain('saved while offline');
      expect(saved?.buffer.length).toBeGreaterThan(0);
      expect(outgoing).toEqual([]);
      const retained = structuredClone(saved!);
      sync.dispose();
      live.dispose();

      // The editor is gone. Construct one visible native unit, then attach the
      // capture/confirmed pair to it; no React, canvas, or second createUnit call.
      live = new NativeReplica(retained.snapshot, kind);
      const unit = live.univer.__getInjector().get(IUniverInstanceService).getUnit(base.id);
      expect(unit).toBeDefined();
      sync = createNativeSyncClient({
        univer: live.univer,
        unitId: base.id,
        kind,
        snapshot: retained.snapshot,
        revision: retained.revision,
        checkpoint: retained,
        persist,
        send: (frame) => outgoing.push(structuredClone(frame)),
        onState() {},
        onResync: (failure) => failures.push(failure),
        preservePendingOnFailure: true,
        requireUnchangedResume: true,
        batchDelayMs: 100_000,
      });
      expect(live.univer.__getInjector().get(IUniverInstanceService).getUnit(base.id)).toBe(unit);
      expect(comparable(live.snapshot())).toEqual(expected);
      sync.setConnected(true);
      sync.receive({
        type: 'resume',
        version: 1,
        unitId: base.id,
        fromRevision: 1,
        revision: 1,
        edits: [],
      });
      await sync.persistNow();
      sync.retry();
      await turns();
      await sync.persistNow();
      await turns();
      const request = outgoing.findLast((frame): frame is SubmitFrame => frame.type === 'submit');
      expect(request).toBeDefined();
      // The resume fence is admission-only, not part of the immutable receipt.
      const durableRequest = structuredClone(request!);
      delete durableRequest.expectedRevision;
      expect(saved!.sent).toEqual(durableRequest);
      const accepted = await f.accept(request!);

      // Until the acknowledgement arrives, retry retains its original identity.
      // The unchanged-base fence conservatively refuses the advanced revision;
      // an ordinary retry of the durable envelope finds the existing receipt.
      sync.retry();
      await turns();
      const retry = outgoing.findLast((frame): frame is SubmitFrame => frame.type === 'submit');
      expect(retry).toEqual(request);
      await expect(f.accept(retry!)).rejects.toMatchObject({ code: 'stale' });
      const duplicate = await f.accept(durableRequest);
      expect(duplicate.duplicate).toBe(true);
      expect(f.storage.history).toHaveLength(1);
      expect(comparable(f.storage.unit.snapshot)).toEqual(expected);

      holdCommit = true;
      sync.receive({
        type: 'ack',
        mutationId: request!.mutationId,
        duplicate: false,
        ...wire(accepted.edit),
      });
      await entered.promise;
      expect(sync.checkpoint()).toMatchObject({ sent: null, inflight: [], buffer: [] });
      expect(sync.state.pending).toBe(true);
      expect(sync.state.localPersistence).toBe('saving');
      expect(saved!.sent).toEqual(durableRequest);
      let joined = false;
      const joining = sync.persistNow().then(() => {
        joined = true;
      });
      await turns();
      expect(joined).toBe(false);
      commit.resolve();
      await joining;
      expect(sync.state.pending).toBe(false);
      expect(sync.state.localPersistence).toBe('saved');
      expect(saved).toMatchObject({ revision: 2, sent: null, inflight: [], buffer: [] });
      expect(comparable(saved!.snapshot)).toEqual(expected);
      const reopened = new NativeReplica(saved!.snapshot, kind);
      try {
        expect(comparable(reopened.snapshot())).toEqual(expected);
      } finally {
        reopened.dispose();
      }
      expect(failures).toEqual([]);
    } finally {
      commit.resolve();
      sync.dispose();
      live.dispose();
      f.close();
    }
  },
);
