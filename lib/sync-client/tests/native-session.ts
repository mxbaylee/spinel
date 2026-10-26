import { ICommandService, IUniverInstanceService, LocaleService, LocaleType } from '@univerjs/core';
import sheetEnglish from '@univerjs/sheets/locale/en-US';
import type { SubmitResult } from '@spinel/sync-server';
import { expect } from 'vitest';
import { createNativeSyncClient, NativeReplica } from '../index.ts';
import type {
  ClientFailure,
  ClientState,
  DocumentKind,
  NativeSnapshot,
  OutgoingFrame,
  SubmitFrame,
  SyncClient,
} from '../index.ts';
import { comparable, fixture, turns, wire } from './fixture.ts';

export interface NativePeer {
  actorId: string;
  live: NativeReplica;
  commands: ICommandService;
  sync: SyncClient;
  outgoing: OutgoingFrame[];
  states: ClientState[];
  failures: ClientFailure[];
}

/** Native command capture and the real client/server, with explicit network delivery. */
export function nativeSession(snapshot: NativeSnapshot, kind: DocumentKind) {
  const f = fixture(snapshot, kind);
  const peers: NativePeer[] = [];
  let identity = 0;
  function resume(peer: NativePeer) {
    peer.sync.setConnected(true);
    peer.sync.receive({
      type: 'resume',
      version: 1,
      unitId: snapshot.id,
      fromRevision: peer.sync.confirmedRevision,
      revision: f.storage.unit.revision,
      edits: f.storage.history
        .filter((edit) => edit.revision > peer.sync.confirmedRevision)
        .map(wire),
    });
  }
  function client(actorId: string): NativePeer {
    const live = new NativeReplica(f.storage.unit.snapshot, kind);
    const injector = live.univer.__getInjector();
    injector.get(LocaleService).load({ [LocaleType.EN_US]: sheetEnglish });
    injector.get(IUniverInstanceService).focusUnit(snapshot.id);
    const outgoing: OutgoingFrame[] = [];
    const states: ClientState[] = [];
    const failures: ClientFailure[] = [];
    const sync = createNativeSyncClient({
      univer: live.univer,
      unitId: snapshot.id,
      kind,
      snapshot: f.storage.unit.snapshot,
      revision: f.storage.unit.revision,
      send: (frame) => outgoing.push(structuredClone(frame)),
      onState: (state) => states.push(structuredClone(state)),
      onResync: (failure) => failures.push(failure),
      mutationId: () => `00000000-0000-4000-8000-${String(++identity).padStart(12, '0')}`,
      batchDelayMs: 100_000,
    });
    const peer = {
      actorId,
      live,
      commands: injector.get(ICommandService),
      sync,
      outgoing,
      states,
      failures,
    };
    peers.push(peer);
    resume(peer);
    return peer;
  }
  return {
    ...f,
    client,
    resume,
    async request(peer: NativePeer): Promise<SubmitFrame> {
      await turns();
      peer.sync.retry();
      await turns();
      const request = peer.outgoing.findLast(
        (frame): frame is SubmitFrame => frame.type === 'submit',
      );
      expect(request).toBeDefined();
      return structuredClone(request!);
    },
    submit(peer: NativePeer, request: SubmitFrame) {
      return f.accept(request, peer.actorId);
    },
    async acknowledge(peer: NativePeer, result: SubmitResult) {
      for (const edit of result.missing)
        if (edit.revision < result.edit.revision)
          peer.sync.receive({ type: 'edit', ...wire(edit) });
      peer.sync.receive({
        type: 'ack',
        mutationId: result.edit.mutationId,
        duplicate: result.duplicate,
        ...wire(result.edit),
      });
      await turns();
    },
    reopen() {
      // JSON is the stored wire representation; load it before any comparison normalization.
      const raw = JSON.parse(JSON.stringify(f.storage.unit.snapshot)) as NativeSnapshot;
      const reopened = new NativeReplica(raw, kind);
      try {
        expect(comparable(reopened.snapshot())).toEqual(comparable(raw));
        return reopened.snapshot();
      } finally {
        reopened.dispose();
      }
    },
    close() {
      for (const peer of peers) {
        peer.sync.dispose();
        peer.live.dispose();
      }
      f.close();
    },
  };
}
