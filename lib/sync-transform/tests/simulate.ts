import { expect } from 'vitest';
import { RefusedEditError, transform as transformAll } from '../index.ts';
import type { Mutation, Side } from '../index.ts';
import { cellIds, targets } from '../src/cells.ts';
import { shiftOf } from '../src/shifts.ts';
import { random } from './random.ts';
import { seededWorkbook } from './generate.ts';
import { Replica } from './harness.ts';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';

/** Makes one random edit from a replica's current state, or null to skip a turn. */
export type Generate = (replica: Replica, next: () => number) => Mutation[] | null;

/** Each token a document holds, with its cell (see `tokensOf`). */
type Tokens = Map<string, string>;

/** An edit's mutations, and the tokens its sender's edit removed (see `simulate`). */
interface Edit {
  mutations: Mutation[];
  removed: Set<string>;
}

interface Client {
  replica: Replica;
  revision: number;
  inflight: Mutation[] | null;
  buffer: Mutation[];
  /** Server messages not yet delivered, in order: an ack or another client's edit. */
  inbox: ({ ack: true } | ({ ack: false } & Edit))[];
  /** Edits sent but not yet received by the server, in order, with the sender's tokens after them. */
  outbox: (Edit & { revision: number; tokens: Tokens })[];
}

/** A cell, as `sheet:row:col`. */
const at = (sheet: string, row: number, col: number) => `${sheet}:${row}:${col}`;
const parse = (key: string) => {
  const [sheet, row, col] = key.split(':');
  return { sheet, row: Number(row), col: Number(col) };
};

/**
 * Seeded values name the cell they started in (`s1:0:2`); the generators
 * write each value, rich text, formula and colour with a token of its own
 * (`w#12`, `c#3`), and never write one twice.
 */
const tokenPattern = /s\d+:\d+:\d+|[wc]#\d+/g;

/**
 * The tokens `replica` holds in a value, formula, rich text or colour, each
 * with its cell. With `where`, throws if one is in two cells: moves move
 * content, and nothing copies it.
 */
function tokensOf(replica: Replica, where?: string): Tokens {
  const found: Tokens = new Map();
  const styles = replica.workbook()!.getStyles();
  for (const sheet of replica.workbook()!.getSheets()) {
    sheet.getCellMatrix().forValue((row, col, cell) => {
      const style = typeof cell?.s === 'string' ? styles.get(cell.s) : cell?.s;
      const text = [cell?.v, cell?.f, cell?.p?.body?.dataStream, style?.cl?.rgb].join(' ');
      const key = at(sheet.getSheetId(), row, col);
      for (const token of new Set(text.match(tokenPattern))) {
        const other = found.get(token);
        if (where && other !== undefined) {
          throw new Error(`${where}: ${token} is in both ${other} and ${key}`);
        }
        found.set(token, key);
      }
    });
  }
  return found;
}

/** Whether `mutation` writes over the piece of `cell` that holds `token`. */
function replaces(mutation: Mutation, cell: string, token: string): boolean {
  const { sheet, row, col } = parse(cell);
  const p = mutation.params;
  if (mutation.id === cellIds.moveRange) {
    return p.to.subUnitId === sheet && p.to.value[row]?.[col] !== undefined;
  }
  if (mutation.id !== cellIds.setRangeValues || p.subUnitId !== sheet) return false;
  const write = p.cellValue[row]?.[col];
  if (write === undefined) return false;
  if (write === null) return true;
  if (!token.startsWith('c#')) return ['v', 'p', 'f'].some((key) => write[key] !== undefined);
  return (
    write.s !== undefined && (write.s === null || !!p.isOverrideStyle || write.s.cl !== undefined)
  );
}

/**
 * Whether `mutation` is a move that takes `cell`'s content to no target, as
 * when a concurrent row or column edit removed the target (see `remapMove` in
 * cells.ts).
 */
function strands(mutation: Mutation, cell: string): boolean {
  const { sheet, row, col } = parse(cell);
  const p = mutation.params;
  if (mutation.id !== cellIds.moveRange || p.from.subUnitId !== sheet) return false;
  return p.from.value[row]?.[col] !== undefined && !targets(mutation).has(`${row}:${col}`);
}

/** Whether `mutation` is a delete-shift that removes `cell`, taking what is there with it. */
function deletes(mutation: Mutation, cell: string): boolean {
  const shift = shiftOf(mutation);
  if (shift?.kind !== 'remove') return false;
  const { sheet, row, col } = parse(cell);
  const { fromRange: band, to } = mutation.params;
  const [index, across, first, last] =
    shift.axis === 'row'
      ? [row, col, band.startColumn, band.endColumn]
      : [col, row, band.startRow, band.endRow];
  const inBand = sheet === to.subUnitId && across >= first && across <= last;
  return inBand && index >= shift.at && index < shift.at + shift.count;
}

/**
 * Two clients and a server, with every message delayed at random, the way a
 * central sync server orders edits: the server transforms each incoming edit
 * past the edits it has accepted since the client's revision (they win), and
 * each client transforms incoming edits past its own unacknowledged ones.
 * An edit the transforms refuse (RefusedEditError) is refused as a server
 * would: its sender discards its pending edits and reloads the server's
 * document, and `stats.refused` counts it. A client that cannot take an
 * incoming edit past its pending ones resyncs the same way.
 *
 * With `intent`, for cell edits only, it also checks the edits keep what
 * they should, by the tokens each replica holds (see `tokensOf`):
 * - No token is ever in two cells of a replica.
 * - Wherever a transformed edit lands, on the server past the edits it
 *   loses to or on a client past its pending ones, every token its sender's
 *   edit removed is gone, unless a winner the sender never saw wrote that
 *   token's piece again. Any other token it removes is in a cell a
 *   delete-shift in it removes, or is the losing side's own content (made
 *   or moved by edits still pending there, as the side's document without
 *   them shows). On a client, that content goes only where the server's
 *   edit writes over its piece, or a move takes it to no target. On the
 *   server it may go anywhere: the sender's own landing checks it.
 *
 * The first rule is the transforms' as a whole: an edit follows content
 * a shift takes, and a drag that meets a concurrent edit of its cells is
 * refused, as are two moves of the same cells. The second rests on three:
 * history wins, so what a loser never saw is the winner's and stays, its
 * moved content included; an edit and a shift commute, so a delete-shift
 * takes its cells with whatever either side wrote there (see `pastEdit` in
 * shifts.ts); and a loser's own content gives way only where a winner's
 * write lands on it, or with a move that takes it to no target.
 *
 * Tokens are text the generators write (see `token` in generate-cells.ts)
 * and the seeded values; numbers and their text stay untokened for
 * retyping, so the checks do not follow them.
 */
export function simulate(options: {
  seed: number;
  document: { workbook?: IWorkbookData; doc?: IDocumentData };
  edits: number;
  generate: Generate;
  /** The most mutations a transform may return per mutation it transforms. */
  budget?: number;
  intent?: boolean;
}) {
  const next = random(options.seed);
  let largest = 0;
  const transform = (a: Mutation[], b: Mutation[], side: Side) => {
    const result = transformAll(a, b, side);
    const inputs = a.length + b.length;
    largest = Math.max(largest, result.length / Math.max(inputs, 1));
    if (options.budget !== undefined && result.length > options.budget * inputs) {
      throw new Error(`${a.length} mutations past ${b.length} became ${result.length}`);
    }
    return result;
  };
  const server = new Replica(options.document);
  const history: (Edit & { revision: number })[] = [];
  const clients: Client[] = [0, 1].map(() => ({
    replica: new Replica(options.document),
    revision: 0,
    inflight: null,
    buffer: [],
    inbox: [],
    outbox: [],
  }));
  const intent = options.intent;
  /** The server's tokens before each history entry, for each side's document without its pending edits. */
  const tokensAt = intent ? [tokensOf(server, 'seeded')] : [];
  const stats = { accepted: 0, refused: 0 };
  const apply = (replica: Replica, mutations: Mutation[], where: string) => {
    replica.apply(mutations);
    if (intent) tokensOf(replica, where);
  };
  /** The history index that last wrote each token's piece on the server, as `replaces` reads it. */
  const writtenAt = new Map<string, number>();
  /**
   * Applies a transformed edit one mutation at a time, checks the tokens it
   * removes as `simulate` says, and returns them. `removed` are the ones it
   * must remove, `gives` tells the losing side's own content that may go,
   * and `kept(token)` a removal the edit lost to a winner's write. On the
   * server, `index` is the edit's place in history, for `writtenAt`.
   */
  const land = (
    replica: Replica,
    { mutations, removed }: Edit,
    where: string,
    gives: (token: string, cell: string, by: Mutation) => boolean,
    kept: (token: string) => boolean = () => false,
    index?: number,
  ): Set<string> => {
    if (!intent) {
      replica.apply(mutations);
      return new Set();
    }
    const before = tokensOf(replica);
    const gone = new Map<string, { cell: string; by: Mutation }>();
    let held = before;
    for (const mutation of mutations) {
      replica.apply([mutation]);
      const now = tokensOf(replica);
      for (const [token, cell] of held)
        if (!now.has(token)) gone.set(token, { cell, by: mutation });
      for (const [token, cell] of now) {
        const wrote = mutation.id === cellIds.setRangeValues && replaces(mutation, cell, token);
        if (index !== undefined && wrote) writtenAt.set(token, index);
      }
      held = now;
    }
    const after = tokensOf(replica, where);
    for (const token of before.keys()) {
      if (after.has(token)) {
        if (!removed.has(token) || kept(token)) continue;
        throw new Error(
          `${where}: ${token} is still in ${after.get(token)}, which its edit removed`,
        );
      }
      const { cell, by } = gone.get(token)!;
      if (removed.has(token) || deletes(by, cell) || gives(token, cell, by)) continue;
      throw new Error(`${where}: ${token} is gone from ${cell}, which ${by.id} took`);
    }
    return new Set([...before.keys()].filter((token) => !after.has(token)));
  };

  const send = (client: Client) => {
    if (client.inflight || client.buffer.length === 0) return;
    client.inflight = client.buffer;
    client.buffer = [];
    const tokens = intent ? tokensOf(client.replica) : new Map<string, string>();
    const base = tokensAt[client.revision] ?? new Map<string, string>();
    client.outbox.push({
      revision: client.revision,
      mutations: client.inflight,
      removed: new Set([...base.keys()].filter((token) => !tokens.has(token))),
      tokens,
    });
  };
  /**
   * Refuses `client`'s pending edits: it discards them and reloads the
   * server's document, which holds every message still on its way to it. The
   * document is rebuilt from the server's history, as the server's was.
   */
  const resync = (client: Client) => {
    stats.refused++;
    client.replica.univer.dispose();
    client.replica = new Replica(options.document);
    for (const { mutations } of history) client.replica.apply(mutations);
    Object.assign(client, { revision: history.length, inflight: null, buffer: [] });
    client.inbox.length = 0;
    client.outbox.length = 0;
  };
  /** Transforms `a` past `b`, or resyncs `client` if the transforms refuse it. */
  const transformOr = (client: Client, a: Mutation[], b: Mutation[], side: Side) => {
    try {
      return transform(a, b, side);
    } catch (error) {
      if (!(error instanceof RefusedEditError)) throw error;
      resync(client);
      return null;
    }
  };
  const receiveAtServer = (from: Client) => {
    const { revision, mutations, removed, tokens } = from.outbox.shift()!;
    let incoming: Mutation[] | null = mutations;
    for (const accepted of history.slice(revision)) {
      incoming = transformOr(from, incoming, accepted.mutations, 'right');
      if (!incoming) return;
    }
    stats.accepted++;
    const index = history.length;
    // The sender's own content is what its tokens put elsewhere than its base.
    const base = tokensAt[revision];
    const taken = land(
      server,
      { mutations: incoming, removed },
      `server at ${index}`,
      (token) => tokens.get(token) !== base.get(token),
      (token) => (writtenAt.get(token) ?? -1) >= revision,
      index,
    );
    if (intent) tokensAt.push(tokensOf(server));
    // Clients check the edit as accepted: what it removed here, it removes there.
    const edit = { mutations: incoming, removed: taken };
    history.push({ ...edit, revision });
    for (const client of clients) {
      client.inbox.push(client === from ? { ack: true } : { ack: false, ...edit });
    }
  };
  const receiveAtClient = (client: Client) => {
    const message = client.inbox.shift()!;
    const base = tokensAt[client.revision];
    client.revision++;
    if (message.ack) {
      client.inflight = null;
      send(client);
      return;
    }
    let incoming = message.mutations;
    for (const key of ['inflight', 'buffer'] as const) {
      const pending = client[key];
      if (!pending || pending.length === 0) continue;
      // The server refuses the pending edits for the same reason. Where only
      // the incoming edit cannot go past them, the client cannot apply it
      // and resyncs as well.
      const kept = transformOr(client, pending, incoming, 'right');
      const past = kept && transformOr(client, incoming, pending, 'left');
      if (!kept || !past) return;
      client[key] = kept;
      incoming = past;
    }
    // The client's own content is what its pending edits put elsewhere than its base.
    const own = intent ? tokensOf(client.replica) : new Map<string, string>();
    const where = `client ${clients.indexOf(client)} at ${client.revision - 1}`;
    land(
      client.replica,
      { mutations: incoming, removed: message.removed },
      where,
      // The client's own content loses where the server's edit replaces it
      // (history wins), whether in the mutation that removes it or, as sent, in
      // one the transform folded into it, as compact folds a clear into the
      // move that empties the cell; or where the move strands it.
      (token, cell, by) =>
        own.get(token) !== base.get(token) &&
        (strands(by, cell) ||
          [by, ...message.mutations].some((mutation) => replaces(mutation, cell, token))),
    );
  };

  let edits = 0;
  while (edits < options.edits) {
    const client = clients[next() % 2];
    const roll = next() % 10;
    if (roll < 4) {
      const mutations = options.generate(client.replica, next);
      if (!mutations || mutations.length === 0) continue;
      apply(client.replica, mutations, `client ${clients.indexOf(client)}`);
      client.buffer.push(...mutations);
      edits += mutations.length;
      if (next() % 2 === 0) send(client);
    } else if (roll < 7 && client.outbox.length > 0) {
      receiveAtServer(client);
    } else if (client.inbox.length > 0) {
      receiveAtClient(client);
    }
  }
  // Deliver everything still in flight.
  for (;;) {
    const busy = clients.find(
      (client) => client.outbox.length > 0 || client.inbox.length > 0 || client.buffer.length > 0,
    );
    if (!busy) break;
    send(busy);
    if (busy.outbox.length > 0) receiveAtServer(busy);
    while (busy.inbox.length > 0) receiveAtClient(busy);
    for (const client of clients) while (client.inbox.length > 0) receiveAtClient(client);
  }
  return { server, clients: clients.map((client) => client.replica), edits, largest, stats };
}

/**
 * Runs `simulate` for seeds 1 to `seeds`, or only `FUZZ_SEED` when set, and
 * checks every client ends with the server's document. A failure names its
 * seed. Returns the number of edits made.
 */
export function convergesOver(
  generate: Generate,
  {
    seeds,
    edits = 300,
    document = { workbook: seededWorkbook() },
    budget,
    seconds,
    intent,
  }: {
    seeds: number;
    edits?: number;
    document?: { workbook?: IWorkbookData; doc?: IDocumentData };
    /** As simulate's. */
    budget?: number;
    /** The longest one seed may take. */
    seconds?: number;
    /** As simulate's. */
    intent?: boolean;
  },
): number {
  const only = process.env.FUZZ_SEED;
  const list = only ? [Number(only)] : Array.from({ length: seeds }, (_, i) => i + 1);
  let total = 0;
  for (const seed of list) {
    let run: ReturnType<typeof simulate>;
    const start = Date.now();
    try {
      run = simulate({ seed, document, edits, generate, budget, intent });
    } catch (error) {
      // Univer rejecting a transformed mutation fails here, not at the comparison.
      throw new Error(`seed ${seed}: ${(error as Error).message}`, { cause: error });
    }
    const took = (Date.now() - start) / 1000;
    if (seconds !== undefined && took > seconds) throw new Error(`seed ${seed} took ${took}s`);
    const expected = run.server.snapshot();
    for (const client of run.clients) expect(client.snapshot(), `seed ${seed}`).toEqual(expected);
    for (const replica of [run.server, ...run.clients]) replica.univer.dispose();
    total += run.edits;
  }
  return total;
}
