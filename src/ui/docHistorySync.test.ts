import { setTimeout as waitForCrypto } from 'node:timers/promises';
import { DocumentFlavor, getDocsEmptySnapshot, IUndoRedoService, LocaleType } from '@univerjs/core';
import type { IDocumentData } from '@univerjs/core';
import { DocSelectionManagerService, DocStateChangeManagerService } from '@univerjs/docs';
import { NORMAL_TEXT_SELECTION_PLUGIN_STYLE } from '@univerjs/engine-render';
import type { Mutation } from '@spinel/sync-transform';
import type { VerifyFrame } from '@spinel/sync-client';
import { afterEach, expect, test, vi } from 'vitest';
import { nativeSession } from '../../lib/sync-client/tests/native-session.ts';
import type { NativePeer } from '../../lib/sync-client/tests/native-session.ts';
import { turns, wire } from '../../lib/sync-client/tests/fixture.ts';
import { envelopeBytes } from '../../lib/sync-client/src/budget.ts';
import { MAX_WIRE_BYTES } from '../../lib/sync-client/src/types.ts';
import { boundDocHistory, DOC_HISTORY_GROUP_LIMIT } from './boundedDocHistory.ts';

// Exact SPN-072/SPN-108 text. The mounted benchmark uses keyboard.type + Enter;
// this native regression isolates history/capture/ACK/verification without UI.
const text = Array.from(
  { length: 16 },
  (_, index) =>
    `Line ${index + 1}: Read the whole paragraph, including the far right edge. ` +
    'Keep the original page size and all of this text when navigating.',
).join('\r');
const point = (at: number) => ({
  startOffset: at,
  endOffset: at,
  collapsed: true,
  segmentId: '',
});

afterEach(() => vi.useRealTimers());

test.each([false, true])(
  'native full-workload history wire-budget contract (bounded=%s)',
  async (bounded) => {
    const f = nativeSession(
      getDocsEmptySnapshot('doc', LocaleType.EN_US, 'History sync', DocumentFlavor.MODERN),
      'doc',
    );
    const writer = f.client('writer'),
      peer = f.client('peer');
    const injector = writer.live.univer.__getInjector();
    const history = injector.get(IUndoRedoService);
    const manager = injector.get(DocStateChangeManagerService);
    const selections = injector.get(DocSelectionManagerService);
    const cap = bounded ? boundDocHistory(writer.live.univer, 'doc') : undefined;
    // Mounted Docs supplies this public logical selection before native typing.
    selections.replaceSelectionInfoWithoutRefresh(
      {
        textRanges: [{ ...point(0), isActive: true }],
        rectRanges: [],
        segmentId: '',
        segmentPage: 0,
        isEditing: true,
        style: NORMAL_TEXT_SELECTION_PLUGIN_STYLE,
      },
      { unitId: 'doc', subUnitId: 'doc' },
    );
    const body = (client: NativePeer) => (client.live.snapshot() as IDocumentData).body!;
    let previousMutationId: string | undefined;
    const verify = async (client: NativePeer) => {
      let frame: VerifyFrame | undefined;
      for (let attempt = 0; attempt < 200 && !frame; attempt++) {
        frame = client.outgoing.findLast(
          (value): value is VerifyFrame =>
            value.type === 'verify' && value.revision === client.sync.confirmedRevision,
        );
        // SubtleCrypto runs outside the fake native debounce clock. Give the
        // real worker a bounded wall-clock window, not an arbitrary turn count.
        if (!frame) await waitForCrypto(5);
      }
      expect(
        frame,
        JSON.stringify({
          actorId: client.actorId,
          state: client.sync.state,
          failures: client.failures,
          history: history.getUndoRedoStatus('doc'),
          selection: selections.getTextRanges({ unitId: 'doc', subUnitId: 'doc' })?.[0],
        }),
      ).toBeDefined();
      const matches = f.server.verify('doc', frame!.revision, frame!.hash, undefined);
      // The host consumes successful `verified` replies. Failed verification
      // follows the real transport's resync path and may never be suppressed.
      if (!matches) client.sync.receive({ type: 'resync', reason: 'divergence' });
      expect(matches).toBe(true);
    };
    const converge = async (length: number) => {
      while (writer.sync.state.pending) {
        const request = await f.request(writer);
        expect(request.mutationId).not.toBe(previousMutationId);
        previousMutationId = request.mutationId;
        expect(envelopeBytes(request.mutations)).toBeLessThanOrEqual(MAX_WIRE_BYTES);
        const result = await f.submit(writer, request);
        await f.acknowledge(writer, result);
        peer.sync.receive({ type: 'edit', ...wire(result.edit) });
        await turns();
        expect(writer.failures).toEqual([]);
        expect(peer.failures).toEqual([]);
      }
      await verify(writer);
      await verify(peer);
      const current = body(writer);
      expect(current.dataStream).toBe(text.slice(0, length) + '\r\n');
      // Raw body equality includes realized paragraph IDs at every history step.
      expect(body(peer)).toEqual(current);
      expect((f.storage.unit.snapshot as IDocumentData).body).toEqual(current);
      expect((writer.sync.checkpoint().snapshot as IDocumentData).body).toEqual(current);
      expect(selections.getTextRanges({ unitId: 'doc', subUnitId: 'doc' })?.[0]).toMatchObject({
        startOffset: length,
        endOffset: length,
      });
      expect(writer.failures).toEqual([]);
      expect(peer.failures).toEqual([]);
    };
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      expect(text.length).toBe(2086);
      for (const [at, character] of [...text].entries())
        expect(
          await writer.commands.executeCommand('doc.command.insert-text', {
            unitId: 'doc',
            segmentId: '',
            range: point(at),
            body:
              character === '\r'
                ? { dataStream: '\r', paragraphs: [{ startIndex: 0 }] }
                : { dataStream: character },
            textRanges: [point(at + 1)],
            debounce: true,
          }),
        ).toBe(true);
      await vi.advanceTimersByTimeAsync(300);
      expect(manager.getStateCache('doc')).toEqual({ history: [], collaboration: [] });
      await converge(text.length);
      const originalBody = structuredClone(body(writer));
      const groups = Math.ceil(text.length / DOC_HISTORY_GROUP_LIMIT);
      expect(groups).toBe(33);
      expect(history.getUndoRedoStatus('doc')).toEqual({ undos: bounded ? groups : 1, redos: 0 });
      if (!bounded) {
        const entry = history.pitchTopUndoElement()!;
        expect(envelopeBytes(entry.redoMutations as Mutation[])).toBeGreaterThan(MAX_WIRE_BYTES);
        expect(await writer.commands.executeCommand('univer.command.undo', { unitId: 'doc' })).toBe(
          true,
        );
        await converge(0);
        expect(history.getUndoRedoStatus('doc')).toEqual({ undos: 0, redos: 1 });
        const revision = f.storage.unit.revision;
        const sent = writer.outgoing.length;
        expect(await writer.commands.executeCommand('univer.command.redo', { unitId: 'doc' })).toBe(
          true,
        );
        expect(body(writer)).toEqual(originalBody);
        expect(writer.failures).toEqual(['capacity']);
        expect(writer.sync.state).toMatchObject({ resyncing: true, failure: 'capacity' });
        expect(writer.outgoing).toHaveLength(sent);
        expect(f.storage.unit.revision).toBe(revision);
        expect((f.storage.unit.snapshot as IDocumentData).body!.dataStream).toBe('\r\n');
        expect(body(peer).dataStream).toBe('\r\n');
        return;
      }
      for (let remaining = groups - 1; remaining >= 0; remaining--) {
        const entry = history.pitchTopUndoElement()!;
        expect(envelopeBytes(entry.redoMutations as Mutation[])).toBeLessThanOrEqual(
          MAX_WIRE_BYTES,
        );
        expect(await writer.commands.executeCommand('univer.command.undo', { unitId: 'doc' })).toBe(
          true,
        );
        await converge(remaining * DOC_HISTORY_GROUP_LIMIT);
        expect(history.getUndoRedoStatus('doc')).toEqual({
          undos: remaining,
          redos: groups - remaining,
        });
      }
      for (let restored = 1; restored <= groups; restored++) {
        const entry = history.pitchTopRedoElement()!;
        expect(envelopeBytes(entry.redoMutations as Mutation[])).toBeLessThanOrEqual(
          MAX_WIRE_BYTES,
        );
        expect(await writer.commands.executeCommand('univer.command.redo', { unitId: 'doc' })).toBe(
          true,
        );
        await converge(Math.min(restored * DOC_HISTORY_GROUP_LIMIT, text.length));
        expect(history.getUndoRedoStatus('doc')).toEqual({
          undos: restored,
          redos: groups - restored,
        });
      }
      expect(body(writer)).toEqual(originalBody);
      expect(manager.getStateCache('doc')).toEqual({ history: [], collaboration: [] });
    } finally {
      cap?.dispose();
      f.close();
    }
  },
  120_000,
);
