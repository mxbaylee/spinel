import type { IWorkbookData } from '@univerjs/core';
import { expect, test } from 'vitest';
import { book, comparable, turns, wire } from './fixture.ts';
import { nativeSession } from './native-session.ts';
import type { NativePeer } from './native-session.ts';

function workbook() {
  const snapshot = book();
  snapshot.sheetOrder.push('ledger');
  snapshot.sheets.ledger = {
    id: 'ledger',
    name: 'Ledger',
    rowCount: 12,
    columnCount: 6,
    cellData: { 3: { 3: { v: 'untouched ledger cell' } } },
  };
  return snapshot;
}

async function write(peer: NativePeer, sheetId: string, column: number, value: object, row = 0) {
  expect(
    await peer.commands.executeCommand('sheet.command.set-range-values', {
      unitId: 'book',
      subUnitId: sheetId,
      range: { startRow: row, endRow: row, startColumn: column, endColumn: column },
      value,
    }),
  ).toBe(true);
}

async function prepare(
  peer: NativePeer,
  action: 'add' | 'copy' | 'rename',
  index: number,
  distinct = false,
) {
  const before = peer.live.snapshot() as IWorkbookData;
  const name = distinct ? ['Alpha', 'Beta'][index] : ['Shared', 'sHaReD'][index];
  if (action === 'rename') {
    expect(
      await peer.commands.executeCommand('sheet.command.set-worksheet-name', {
        unitId: 'book',
        subUnitId: ['one', 'two'][index],
        name,
      }),
    ).toBe(true);
  } else {
    expect(
      await peer.commands.executeCommand(
        action === 'add' ? 'sheet.command.insert-sheet' : 'sheet.command.copy-sheet',
        action === 'copy'
          ? { unitId: 'book', subUnitId: 'one' }
          : { unitId: 'book', ...(distinct ? { sheet: { name } } : {}) },
      ),
    ).toBe(true);
  }
  const after = peer.live.snapshot() as IWorkbookData;
  const id =
    action === 'rename'
      ? ['one', 'two'][index]
      : after.sheetOrder.find((sheetId) => !before.sheetOrder.includes(sheetId))!;
  const sheetName = after.sheets[id].name!;
  await write(peer, id, 0, { v: 10 + index });
  const formula = `='${sheetName.replaceAll("'", "''")}'!A1`;
  await write(peer, 'ledger', index, { f: formula });
  expect(peer.sync.state.pending).toBe(true);
  expect(peer.failures).toEqual([]);
  return { id, name: sheetName, formula, value: 10 + index };
}

for (const action of ['add', 'copy', 'rename'] as const) {
  for (const winner of [0, 1]) {
    for (const earlyDelivery of [false, true]) {
      test(`native ${action} collision preserves formula identity after reconnect (winner ${winner}, early ${earlyDelivery})`, async () => {
        const f = nativeSession(workbook(), 'sheet');
        try {
          const peers = [f.client('owner'), f.client('collaborator')];
          await turns();
          const targets = [await prepare(peers[0], action, 0), await prepare(peers[1], action, 1)];
          expect(targets[0].name.toLowerCase()).toBe(targets[1].name.toLowerCase());
          expect(targets[0].id).not.toBe(targets[1].id);
          const requests = [await f.request(peers[0]), await f.request(peers[1])];
          const loser = 1 - winner;
          // Unsent work made after the conflicting request must not be reported as saved.
          await write(peers[loser], 'ledger', loser, { v: 'unsent after collision' }, 1);
          const accepted = await f.submit(peers[winner], requests[winner]);
          if (earlyDelivery) peers[loser].sync.receive({ type: 'edit', ...wire(accepted.edit) });

          // The server committed, but its acknowledgment was lost. Resume/retry must
          // use exactly the original request and its durable receipt, not add a sheet twice.
          peers[winner].sync.setConnected(false);
          f.resume(peers[winner]);
          const retry = await f.request(peers[winner]);
          expect(retry).toEqual(requests[winner]);
          const duplicate = await f.submit(peers[winner], retry);
          expect(duplicate.duplicate).toBe(true);
          expect(duplicate.edit.revision).toBe(accepted.edit.revision);
          await f.acknowledge(peers[winner], duplicate);

          peers[loser].sync.setConnected(false);
          f.resume(peers[loser]);
          expect(await f.request(peers[loser])).toEqual(requests[loser]);
          // Decision 37: refuse the later identity collision. A suffix on the
          // sheet alone could silently make the pending formula target the winner.
          await expect(f.submit(peers[loser], requests[loser])).rejects.toMatchObject({
            code: 'refused',
          });
          peers[loser].sync.receive({
            type: 'resync',
            reason: 'refused',
            mutationId: requests[loser].mutationId,
          });
          await turns();
          expect(peers[loser].sync.state).toMatchObject({ resyncing: true, failure: 'refused' });
          expect(peers[loser].failures).toEqual(['refused']);
          expect(peers[loser].sync.checkpoint()).toMatchObject({ sent: null, buffer: [] });
          expect(
            peers[winner].sync.state,
            JSON.stringify(peers[winner].sync.checkpoint().buffer),
          ).toMatchObject({ revision: 2, pending: false, resyncing: false });
          expect(peers[winner].failures).toEqual([]);
          expect(f.storage.history).toHaveLength(1);

          // The application reloads on onResync. Recreate that client from the
          // raw persisted snapshot rather than treating its optimistic view as saved.
          const reloaded = f.client('reloaded-collaborator');
          const snapshot = f.reopen() as IWorkbookData;
          for (const peer of [peers[winner], reloaded])
            expect(comparable(peer.live.snapshot())).toEqual(comparable(snapshot));
          const target = targets[winner];
          expect(snapshot.sheets[target.id].name).toBe(target.name);
          expect(snapshot.sheets[target.id].cellData![0][0]?.v).toBe(target.value);
          expect(snapshot.sheets.ledger.cellData![0][winner]?.f).toBe(target.formula);
          expect(snapshot.sheets.ledger.cellData![0][loser]?.f).toBeUndefined();
          expect(snapshot.sheets.ledger.cellData![1]?.[loser]).toBeUndefined();
          expect(snapshot.sheets.ledger.cellData![3][3]?.v).toBe('untouched ledger cell');
          expect(
            new Set(Object.values(snapshot.sheets).map((sheet) => sheet.name!.toLowerCase())).size,
          ).toBe(snapshot.sheetOrder.length);
          if (action !== 'rename') expect(snapshot.sheets[targets[loser].id]).toBeUndefined();
          else expect(snapshot.sheets[targets[loser].id].name).toBe(['One', 'Two'][loser]);
        } finally {
          f.close();
        }
      });
    }
  }
}

test.each([0, 1])(
  'distinct native additions and pending formulas survive both accepted requests (%s first)',
  async (first) => {
    const f = nativeSession(workbook(), 'sheet');
    try {
      const peers = [f.client('owner'), f.client('collaborator')];
      await turns();
      const targets = [
        await prepare(peers[0], 'add', 0, true),
        await prepare(peers[1], 'add', 1, true),
      ];
      const requests = [await f.request(peers[0]), await f.request(peers[1])];
      const second = 1 - first;
      const acceptedFirst = await f.submit(peers[first], requests[first]);
      await f.acknowledge(peers[first], acceptedFirst);
      peers[second].sync.receive({ type: 'edit', ...wire(acceptedFirst.edit) });
      const acceptedSecond = await f.submit(peers[second], requests[second]);
      await f.acknowledge(peers[second], acceptedSecond);
      peers[first].sync.receive({ type: 'edit', ...wire(acceptedSecond.edit) });
      await turns();
      const snapshot = f.reopen() as IWorkbookData;
      for (const [index, peer] of peers.entries()) {
        expect(peer.failures).toEqual([]);
        expect(peer.sync.state, JSON.stringify(peer.sync.checkpoint().buffer)).toMatchObject({
          revision: 3,
          pending: false,
          resyncing: false,
        });
        expect(comparable(peer.live.snapshot())).toEqual(comparable(snapshot));
        expect(snapshot.sheets[targets[index].id].name).toBe(targets[index].name);
        expect(snapshot.sheets[targets[index].id].cellData![0][0]?.v).toBe(targets[index].value);
        expect(snapshot.sheets.ledger.cellData![0][index]?.f).toBe(targets[index].formula);
      }
      expect(snapshot.sheets.ledger.cellData![3][3]?.v).toBe('untouched ledger cell');
    } finally {
      f.close();
    }
  },
);

test.each([0, 1])(
  'native distinct renames with pending reference writes follow conservative refusal (%s first)',
  async (first) => {
    const f = nativeSession(workbook(), 'sheet');
    try {
      const peers = [f.client('owner'), f.client('collaborator')];
      await turns();
      const targets = [
        await prepare(peers[0], 'rename', 0, true),
        await prepare(peers[1], 'rename', 1, true),
      ];
      const requests = [await f.request(peers[0]), await f.request(peers[1])];
      const second = 1 - first;
      const accepted = await f.submit(peers[first], requests[first]);
      await f.acknowledge(peers[first], accepted);
      // The existing formula-race policy also protects distinct names: the
      // transform cannot infer a formula's target from base cells alone.
      await expect(f.submit(peers[second], requests[second])).rejects.toMatchObject({
        code: 'refused',
      });
      peers[second].sync.receive({
        type: 'resync',
        reason: 'refused',
        mutationId: requests[second].mutationId,
      });
      await turns();
      expect(peers[second].failures).toEqual(['refused']);
      expect(peers[second].sync.state).toMatchObject({ failure: 'refused', resyncing: true });
      const saved = f.reopen() as IWorkbookData;
      expect(saved.sheets[targets[first].id].name).toBe(targets[first].name);
      expect(saved.sheets[targets[second].id].name).toBe(['One', 'Two'][second]);
      expect(saved.sheets.ledger.cellData![0][first]?.f).toBe(targets[first].formula);
      expect(saved.sheets.ledger.cellData![0][second]?.f).toBeUndefined();
      expect(saved.sheets.ledger.cellData![3][3]?.v).toBe('untouched ledger cell');
      expect(comparable(peers[first].live.snapshot())).toEqual(comparable(saved));
      expect(comparable(f.client('reloaded').live.snapshot())).toEqual(comparable(saved));
    } finally {
      f.close();
    }
  },
);

test.each([0, 1])(
  'a formula buffered behind a colliding native Add Sheet waits for its own acknowledgment (%s first)',
  async (first) => {
    const f = nativeSession(workbook(), 'sheet');
    try {
      const peers = [f.client('owner'), f.client('collaborator')];
      await turns();
      const targets: { id: string; name: string }[] = [];
      for (const peer of peers) {
        expect(
          await peer.commands.executeCommand('sheet.command.insert-sheet', { unitId: 'book' }),
        ).toBe(true);
        const value = peer.live.snapshot() as IWorkbookData;
        const id = value.sheetOrder.find((sheetId) => !workbook().sheetOrder.includes(sheetId))!;
        targets.push({ id, name: value.sheets[id].name! });
      }
      const requests = [await f.request(peers[0]), await f.request(peers[1])];
      for (const [index, peer] of peers.entries()) {
        await write(peer, targets[index].id, 0, { v: 50 + index });
        await write(peer, 'ledger', index, { f: `='${targets[index].name}'!A1` });
        expect(peer.sync.checkpoint().buffer.length).toBeGreaterThan(0);
      }
      const second = 1 - first;
      const accepted = await f.submit(peers[first], requests[first]);
      await expect(f.submit(peers[second], requests[second])).rejects.toMatchObject({
        code: 'refused',
      });
      peers[second].sync.receive({
        type: 'resync',
        reason: 'refused',
        mutationId: requests[second].mutationId,
      });
      peers[first].sync.setConnected(false);
      f.resume(peers[first]);
      expect(await f.request(peers[first])).toEqual(requests[first]);
      const duplicate = await f.submit(peers[first], requests[first]);
      expect(duplicate.duplicate).toBe(true);
      await f.acknowledge(peers[first], duplicate);
      expect(peers[first].sync.state).toMatchObject({
        pending: true,
        revision: accepted.edit.revision,
      });
      const formulaRequest = await f.request(peers[first]);
      expect(formulaRequest.mutationId).not.toBe(requests[first].mutationId);
      expect(formulaRequest.baseRevision).toBe(2);
      await f.acknowledge(peers[first], await f.submit(peers[first], formulaRequest));
      await turns();
      const saved = f.reopen() as IWorkbookData;
      expect(saved.sheets[targets[first].id].cellData![0][0]?.v).toBe(50 + first);
      expect(saved.sheets.ledger.cellData![0][first]?.f).toBe(`='${targets[first].name}'!A1`);
      expect(saved.sheets[targets[second].id]).toBeUndefined();
      expect(saved.sheets.ledger.cellData![0][second]?.f).toBeUndefined();
      expect(peers[first].sync.state).toMatchObject({
        pending: false,
        resyncing: false,
        revision: 3,
      });
      expect(peers[second].sync.checkpoint().buffer).toEqual([]);
      expect(peers[second].failures).toEqual(['refused']);
      expect(f.storage.history).toHaveLength(2);
      expect(comparable(peers[first].live.snapshot())).toEqual(comparable(saved));
      expect(comparable(f.client('reloaded').live.snapshot())).toEqual(comparable(saved));
    } finally {
      f.close();
    }
  },
);
