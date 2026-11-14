import { describe, expect, test, vi } from 'vitest';
import { JSONX, TextX } from '@univerjs/core';
import type { Mutation } from '@spinel/sync-transform';
import { canonical } from '@spinel/sync-transform';
import type { ClientCheckpoint, WireRevision } from '../index.ts';
import { encodedBytes } from '../src/budget.ts';
import { book, comparable, doc, fixture, turns, wire, write } from './fixture.ts';

const acknowledge = (mutationId: string, edit: WireRevision, duplicate = false) => ({
  type: 'ack' as const,
  mutationId,
  duplicate,
  ...edit,
});

test('transport opening does not send new work before ordered resume; own edit waits for ack', async () => {
  const f = fixture();
  const a = f.client();
  try {
    a.edit([write({ v: 'mine' })]);
    a.sync.setConnected(true);
    a.sync.retry();
    await turns();
    expect(a.submits()).toHaveLength(0);
    expect(a.sync.state.pending).toBe(true);
    a.resume();
    await turns();
    const request = a.submits()[0];
    const result = await f.accept(request);
    a.sync.receive({ type: 'edit', ...wire(result.edit) });
    expect(a.sync.confirmedRevision).toBe(1);
    expect(a.sync.state.pending).toBe(true);
    a.sync.receive(acknowledge(request.mutationId, wire(result.edit)));
    expect(a.sync.confirmedRevision).toBe(2);
    expect(a.sync.state.pending).toBe(false);
    expect(comparable(a.live.snapshot())).toEqual(comparable(f.storage.unit.snapshot));
    a.sync.receive(acknowledge(request.mutationId, wire(result.edit), true));
    a.sync.receive({ type: 'edit', ...wire(result.edit) });
    expect(comparable(a.live.snapshot())).toEqual(comparable(f.storage.unit.snapshot));
    expect(a.failures).toEqual([]);
  } finally {
    f.close();
  }
});

test('confirmed plus OLD inflight is the buffer base; transformed claims and tails remain together', async () => {
  const f = fixture();
  const a = f.client();
  const b = f.client();
  try {
    a.resume();
    b.resume();
    await turns();
    a.edit([write({ s: { bl: 1 } })]);
    a.sync.retry();
    await turns();
    const first = structuredClone(a.submits()[0]);
    a.edit([write({ custom: { note: 'buffer' } })]);
    b.edit([write({ v: 'peer' })]);
    b.sync.retry();
    await turns();
    const peerRequest = b.submits()[0];
    const peer = await f.accept(peerRequest, 'b');
    a.sync.receive({ type: 'edit', ...wire(peer.edit) });
    b.sync.receive({ type: 'edit', ...wire(peer.edit) });
    b.sync.receive(acknowledge(peerRequest.mutationId, wire(peer.edit)));
    const mine = await f.accept(first);
    for (const client of [a, b]) client.sync.receive({ type: 'edit', ...wire(mine.edit) });
    a.sync.receive(acknowledge(first.mutationId, wire(mine.edit)));
    expect(a.sync.checkpoint().sent).toBeNull();
    a.sync.retry();
    await turns();
    const buffered = a.submits()[1];
    expect(buffered.baseRevision).toBe(3);
    expect(buffered.mutations.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(buffered)).toContain('sync-transform.cells.claim');
    const final = await f.accept(buffered);
    for (const client of [a, b]) client.sync.receive({ type: 'edit', ...wire(final.edit) });
    a.sync.receive(acknowledge(buffered.mutationId, wire(final.edit)));
    expect(a.submits()[0]).toEqual(first);
    for (const client of [a, b]) {
      expect(client.failures).toEqual([]);
      expect(comparable(client.live.snapshot())).toEqual(comparable(f.storage.unit.snapshot));
    }
  } finally {
    f.close();
  }
});

test('lost commit acknowledgement retries the original request after replaying later revisions', async () => {
  const f = fixture();
  const a = f.client();
  const b = f.client();
  try {
    a.resume();
    b.resume();
    await turns();
    const insert: Mutation = {
      id: 'sheet.mutation.insert-row',
      params: {
        unitId: 'book',
        subUnitId: 'one',
        range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 5 },
        rowInfo: { 0: {} },
        trigger: 'sheet.command.insert-row',
      },
    };
    a.edit([insert]);
    a.sync.retry();
    await turns();
    const original = structuredClone(a.submits()[0]);
    a.edit([write({ v: 'queued-after-row-insert' }, 0, 1)]);
    await f.accept(original);
    // The server committed, but neither its edit nor its ack reached A.
    a.sync.setConnected(false);
    b.sync.receive({ type: 'edit', ...wire(f.storage.history[0]) });
    b.edit([write({ v: 'peer-after-commit' }, 3, 2)]);
    b.sync.retry();
    await turns();
    const peerRequest = b.submits()[0];
    const peer = await f.accept(peerRequest, 'b');
    b.sync.receive({ type: 'edit', ...wire(peer.edit) });
    b.sync.receive(acknowledge(peerRequest.mutationId, wire(peer.edit)));
    a.resume();
    await turns();
    expect(a.submits()[1]).toEqual(original);
    expect(a.sync.state.pending).toBe(true);
    const retried = await f.accept(a.submits()[1]);
    expect(retried.duplicate).toBe(true);
    expect(f.storage.unit.revision).toBe(3);
    a.sync.receive(acknowledge(original.mutationId, wire(retried.edit), true));
    a.sync.retry();
    await turns();
    const buffered = a.submits()[2];
    const final = await f.accept(buffered);
    for (const client of [a, b]) client.sync.receive({ type: 'edit', ...wire(final.edit) });
    a.sync.receive(acknowledge(buffered.mutationId, wire(final.edit)));
    expect(
      f.storage.history.filter((edit) => edit.mutationId === original.mutationId),
    ).toHaveLength(1);
    expect((f.storage.unit.snapshot as ReturnType<typeof book>).sheets.one.rowCount).toBe(13);
    for (const client of [a, b]) {
      expect(client.failures).toEqual([]);
      expect(comparable(client.live.snapshot())).toEqual(comparable(f.storage.unit.snapshot));
    }
  } finally {
    f.close();
  }
});

test.each(['ack', 'refusal'] as const)(
  'stale resume waits for the unknown inflight %s before reload',
  async (answer) => {
    const f = fixture();
    const a = f.client();
    try {
      a.resume();
      await turns();
      a.edit([write({ v: 'sent' })]);
      a.sync.retry();
      await turns();
      const request = structuredClone(a.submits()[0]);
      a.edit([write({ v: 'not-sent' }, 2)]);
      a.sync.setConnected(false);
      a.sync.setConnected(true);
      a.sync.receive({ type: 'resync', reason: 'stale' });
      expect(a.failures).toEqual([]);
      expect(a.sync.checkpoint().buffer).toEqual([]);
      expect(a.sync.checkpoint().sent).toEqual(request);
      expect(a.submits().at(-1)).toEqual(request);
      if (answer === 'ack') {
        const accepted = await f.accept(request);
        a.sync.receive(acknowledge(request.mutationId, wire(accepted.edit)));
        expect(f.storage.unit.revision).toBe(2);
      } else a.sync.receive({ type: 'resync', reason: 'refused', mutationId: request.mutationId });
      expect(a.failures).toEqual(['stale']);
      expect(a.sync.state.pending).toBe(false);
    } finally {
      f.close();
    }
  },
);

test('failure against only the unsent move still retains a server-accepted inflight edit', async () => {
  const f = fixture();
  const a = f.client();
  const b = f.client();
  try {
    a.resume();
    b.resume();
    await turns();
    a.edit([write({ v: 'durable' }, 5, 5)]);
    a.sync.retry();
    await turns();
    const request = a.submits()[0];
    a.edit([
      {
        id: 'sheet.mutation.move-range',
        params: {
          unitId: 'book',
          from: { subUnitId: 'one', value: { 0: { 0: null } } },
          to: { subUnitId: 'one', value: { 0: { 1: { v: 'base', t: 1, fd: 1 } } } },
          fromRange: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
          toRange: { startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 },
          trigger: 'sheet.command.move-range',
        },
      },
    ]);
    b.edit([write({ v: 'peer' })]);
    b.sync.retry();
    await turns();
    const peer = await f.accept(b.submits()[0], 'b');
    a.sync.receive({ type: 'edit', ...wire(peer.edit) });
    const mine = await f.accept(request);
    a.sync.receive({ type: 'edit', ...wire(mine.edit) });
    expect(a.failures).toEqual([]);
    a.sync.receive(acknowledge(request.mutationId, wire(mine.edit)));
    expect(a.failures).toEqual(['refused']);
    expect(a.sync.checkpoint().sent).toBeNull();
    expect((f.storage.unit.snapshot as ReturnType<typeof book>).sheets.one.cellData![5][5].v).toBe(
      'durable',
    );
  } finally {
    f.close();
  }
});

test('visible-model verification is fenced by newer edits and disconnection', async () => {
  const hashes: ReturnType<typeof Promise.withResolvers<string>>[] = [];
  const f = fixture();
  const visible = vi.fn();
  const a = f.client({
    hash: async (snapshot) => {
      visible(snapshot);
      const deferred = Promise.withResolvers<string>();
      hashes.push(deferred);
      return deferred.promise;
    },
  });
  const b = f.client();
  try {
    a.resume();
    b.resume();
    await turns();
    b.edit([write({ v: 'peer' })]);
    b.sync.retry();
    await turns();
    const peer = await f.accept(b.submits()[0], 'b');
    a.sync.receive({ type: 'edit', ...wire(peer.edit) });
    expect(visible).toHaveBeenCalledWith(a.live.snapshot());
    a.edit([write({ v: 'new' }, 4)]);
    hashes[0].resolve('a'.repeat(64));
    await turns();
    expect(a.outgoing.filter((frame) => frame.type === 'verify')).toEqual([]);
    a.sync.retry();
    await turns();
    const mine = await f.accept(a.submits()[0]);
    a.sync.receive({ type: 'edit', ...wire(mine.edit) });
    a.sync.receive(acknowledge(a.submits()[0].mutationId, wire(mine.edit)));
    a.sync.setConnected(false);
    hashes.at(-1)!.resolve('b'.repeat(64));
    await turns();
    expect(a.outgoing.filter((frame) => frame.type === 'verify')).toEqual([]);
  } finally {
    for (const hash of hashes) hash.resolve('c'.repeat(64));
    f.close();
  }
});

test('persistence saves the immutable envelope before sending and remains dirty until the latest save finishes', async () => {
  const checkpoints: ClientCheckpoint[] = [];
  const writes: ReturnType<typeof Promise.withResolvers<void>>[] = [];
  const f = fixture();
  const a = f.client({
    persist: (capture) => {
      checkpoints.push(capture());
      const deferred = Promise.withResolvers<void>();
      writes.push(deferred);
      return deferred.promise;
    },
  });
  const finishStore = async () => {
    for (let index = 0; index < 20; index++) {
      for (const pending of writes) pending.resolve();
      await turns();
    }
  };
  try {
    a.resume();
    await finishStore();
    a.edit([write({ v: 'store-first' })]);
    a.sync.retry();
    await turns();
    expect(a.submits()).toHaveLength(0);
    await finishStore();
    a.sync.retry();
    await turns();
    expect(a.submits()).toHaveLength(0);
    expect(checkpoints.at(-1)!.sent?.mutations).toEqual([write({ v: 'store-first' })]);
    await finishStore();
    expect(a.submits()).toHaveLength(1);
    const accepted = await f.accept(a.submits()[0]);
    a.sync.receive(acknowledge(a.submits()[0].mutationId, wire(accepted.edit)));
    expect(a.sync.state.pending).toBe(true);
    a.edit([write({ v: 'newer' }, 3)]);
    writes.at(-1)?.resolve();
    await turns();
    expect(a.sync.state.pending).toBe(true);
    await finishStore();
    expect(a.sync.state.pending).toBe(true);
  } finally {
    for (const pending of writes) pending.resolve();
    f.close();
  }
});

test('inbox growth is bounded while an acknowledgment is missing', async () => {
  const f = fixture();
  const a = f.client();
  try {
    a.resume();
    await turns();
    a.edit([write({ v: 'mine' })]);
    a.sync.retry();
    await turns();
    for (let revision = 2; revision <= 130; revision++)
      a.sync.receive({
        type: 'edit',
        revision,
        mutations: [],
        touched: { kind: 'sheet', cells: [] },
        hash: 'a'.repeat(64),
      });
    expect(a.sync.state.failure).toBe('capacity');
    expect(a.failures).toEqual([]);
    a.sync.receive({ type: 'resync', reason: 'stale', mutationId: a.submits()[0].mutationId });
    expect(a.failures).toEqual(['capacity']);
  } finally {
    f.close();
  }
});

test('a lagging batch timer queues edits up to the exact pending byte limit', () => {
  const f = fixture();
  const a = f.client();
  try {
    // Never connected: nothing drains, as when typing outruns the batch timer.
    const limit = 10 * 1024 * 1024;
    a.sync.enqueue([write({ v: 'x'.repeat(30_000) })]);
    const base = JSON.stringify(a.sync.checkpoint().buffer[0]).length;
    // The buffer is a JSON array of groups: brackets, each group, one comma between.
    // Pick the payload whose count leaves the least room, so a one-byte error changes the count.
    const slack = (extra: number) => (limit - 1) % (base + extra + 1);
    let extra = 0;
    for (let size = 0; size < 400; size++) if (slack(size) > slack(extra)) extra = size;
    const edit = () => write({ v: 'x'.repeat(30_000 + extra) });
    const b = f.client();
    const fits = Math.floor((limit - 1) / (base + extra + 1));
    for (let index = 0; index < fits; index++) b.sync.enqueue([edit()]);
    expect(b.failures).toEqual([]);
    expect(JSON.stringify(b.sync.checkpoint().buffer).length).toBeLessThanOrEqual(limit);
    b.sync.enqueue([edit()]);
    expect(b.failures).toEqual(['capacity']);
  } finally {
    f.close();
  }
});

const PENDING_LIMIT = 10 * 1024 * 1024;

test('the queued-byte limit tracks the buffer after a partial pump and a remote rebase', async () => {
  const big = (row: number, size: number) => [write({ v: '😀漢x'.repeat(size / 8) }, row)];
  // Pick the group size (~30 KB, so one pump request takes one or two) that leaves the
  // least slack under the limit, so the room measured later is about two groups.
  let size = 30_000;
  const slack = (n: number) => (PENDING_LIMIT - 1) % (encodedBytes(big(0, n)) + 1);
  for (let n = 30_000; n < 31_000; n += 8) if (slack(n) < slack(size)) size = n;
  const run = async (probeExtra: number) => {
    const f = fixture();
    const a = f.client();
    try {
      a.resume();
      await turns();
      // Leave one group's room, so the budget for expanded cells is not what trips first.
      const count = Math.floor((PENDING_LIMIT - 1) / (encodedBytes(big(0, size)) + 1)) - 1;
      for (let row = 0; row < count; row++) a.sync.enqueue(big(row, size));
      expect(a.failures).toEqual([]);
      const before = a.sync.checkpoint().buffer.length;
      a.sync.retry();
      await turns();
      expect(a.submits()).toHaveLength(1);
      const remaining = a.sync.checkpoint().buffer.length;
      expect(remaining).toBeLessThan(before);
      expect(remaining).toBeGreaterThan(0);
      // A remote revision touching the first still-buffered cell rebases and replaces the buffer.
      const row = before - remaining;
      a.sync.receive({
        type: 'edit',
        revision: a.sync.confirmedRevision + 1,
        mutations: [write({ v: 'peer' }, row, 0)],
        touched: { kind: 'sheet', cells: [{ sheetId: 'one', row, column: 0 }] },
        hash: 'a'.repeat(64),
      });
      await turns();
      expect(a.failures).toEqual([]);
      // Room left by a full re-encode. Spend most of it on ordinary groups, then queue a group
      // sized to take exactly the rest (+ probeExtra): one request-sized group at the limit.
      const roomNow = () => PENDING_LIMIT - encodedBytes(a.sync.checkpoint().buffer) - 1;
      const probe = (pad: number) => [write({ v: 'y'.repeat(pad) }, 400)];
      let filler = 0;
      while (roomNow() > 40_000) {
        a.sync.enqueue(big(500 + filler++, 20_000));
        expect(a.sync.state.failure).toBeUndefined();
      }
      expect(filler).toBeGreaterThan(0);
      const room = roomNow();
      const pad = room - encodedBytes(probe(0));
      expect(encodedBytes(probe(pad))).toBe(room);
      a.sync.enqueue(probe(pad + probeExtra));
      return a.sync.state.failure;
    } finally {
      f.close();
    }
  };
  // Exactly the free room fits; one byte more is over the limit.
  expect(await run(0)).toBeUndefined();
  expect(await run(1)).toBe('capacity');
});

test('queuing N small groups encodes O(N) bytes, not the whole buffer each time', () => {
  const measure = (groups: number) => {
    const f = fixture();
    const a = f.client();
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    try {
      for (let row = 0; row < groups; row++)
        a.sync.enqueue([write({ v: `c${row}` }, row % 400, row)]);
      expect(a.failures).toEqual([]);
      expect(a.sync.checkpoint().buffer).toHaveLength(groups);
      return encode.mock.calls.reduce((sum, [text]) => sum + (text?.length ?? 0), 0);
    } finally {
      encode.mockRestore();
      f.close();
    }
  };
  const small = measure(500);
  const large = measure(2000);
  // 4x the groups: linear work is ~4x, a full re-encode per enqueue would be ~16x.
  expect(large / small).toBeLessThan(6);
  // And no enqueue re-measures the buffer: 2000 groups of ~150 bytes is ~300 KB, ~10 MB if re-encoded.
  expect(large).toBeLessThan(2000 * 2000);
});

test('a group that cannot be sized is refused without a half-queued group', () => {
  const f = fixture();
  const a = f.client();
  try {
    a.sync.enqueue([write({ v: '漢字😀' })]);
    expect(a.sync.state.pendingMutations).toBe(1);
    // JSON cannot encode a bigint, so sizing the cloned group throws mid-enqueue.
    a.sync.enqueue([write({ v: 1n as unknown as number }, 1)]);
    expect(a.sync.state.failure).toBeDefined();
    // Refusal discards the buffer wholesale; nothing from the failed group is left behind.
    expect(a.sync.checkpoint().buffer).toEqual([]);
    expect(a.sync.state.pendingMutations).toBe(0);
  } finally {
    f.close();
  }
});

test('unknown mutations and oversized atomic edits are refused locally', () => {
  const f = fixture();
  const a = f.client();
  const b = f.client();
  try {
    a.sync.enqueue([{ id: 'sheet.operation.unrecognized-mutation', params: { unitId: 'book' } }]);
    b.sync.enqueue([write({ v: 'x'.repeat(70_000) })]);
    expect(a.failures).toEqual(['unsupported']);
    expect(b.failures).toEqual(['capacity']);
    expect(a.submits()).toEqual([]);
    expect(b.submits()).toEqual([]);
  } finally {
    f.close();
  }
});

describe.each(['sheet', 'doc'] as const)('two actual %s models and durable server', (kind) => {
  test('converge through delayed acknowledgments and repeated socket loss', async () => {
    for (let seed = 1; seed <= 8; seed++) {
      const f = fixture(kind === 'sheet' ? book() : doc(), kind);
      const clients = [f.client(), f.client()];
      let random = seed;
      const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
      const delivered = [0, 0];
      try {
        for (const client of clients) client.resume();
        await turns();
        const deliver = async (index: number) => {
          const client = clients[index];
          client.sync.retry();
          await turns();
          const request = client.submits()[delivered[index]++];
          if (!request) {
            delivered[index]--;
            return;
          }
          const accepted = await f.accept(request, String(index));
          // Lose both frames for this client after a real non-idempotent commit.
          const lose = next() % 5 === 0;
          for (const [other, peer] of clients.entries()) {
            if (other === index && lose) continue;
            peer.sync.receive({ type: 'edit', ...wire(accepted.edit) });
          }
          if (lose) {
            client.sync.setConnected(false);
            client.resume();
            await turns();
          } else
            client.sync.receive(
              acknowledge(request.mutationId, wire(accepted.edit), accepted.duplicate),
            );
        };
        for (let step = 0; step < 30; step++) {
          const index = next() % 2;
          const client = clients[index];
          let mutations: Mutation[];
          if (kind === 'sheet')
            mutations = [
              write(
                next() % 3 === 0
                  ? { s: { bl: (next() % 2) as 0 | 1, it: (next() % 2) as 0 | 1 } }
                  : { v: `${seed}:${step}`, custom: { step } },
                next() % 4,
                next() % 3,
              ),
            ];
          else {
            const body = (client.live.snapshot() as ReturnType<typeof doc>).body!;
            const at = next() % (body.dataStream.length - 1);
            const text = new TextX();
            if (at) text.push({ t: 'r' as never, len: at });
            const value = `${seed}:${step} `;
            text.push({ t: 'i' as never, len: value.length, body: { dataStream: value } });
            mutations = [
              {
                id: 'doc.mutation.rich-text-editing',
                params: {
                  unitId: 'doc',
                  actions: JSONX.getInstance().editOp(text.serialize()),
                  textRanges: [],
                  trigger: 'doc.command.insert-text',
                },
              },
            ];
          }
          client.edit(mutations);
          if (next() % 3 !== 0) await deliver(next() % 2);
        }
        for (
          let round = 0;
          round < 200 && clients.some((client) => client.sync.state.pending);
          round++
        )
          for (let index = 0; index < clients.length; index++) await deliver(index);
        for (const client of clients) {
          expect(client.failures, `seed ${seed}`).toEqual([]);
          expect(client.sync.state.pending, `seed ${seed}`).toBe(false);
          expect(canonical(comparable(client.live.snapshot())), `seed ${seed}`).toBe(
            canonical(comparable(f.storage.unit.snapshot)),
          );
        }
      } finally {
        f.close();
      }
    }
  });
});
