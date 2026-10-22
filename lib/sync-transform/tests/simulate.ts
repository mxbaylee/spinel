import { expect } from 'vitest';
import { flip, RefusedEditError, transform as transformAll } from '../index.ts';
import type { Mutation, Side } from '../index.ts';
import { mapIndex } from '../src/axis.ts';
import { cellIds, writesOf } from '../src/cells.ts';
import { shiftOf } from '../src/shifts.ts';
import { axisEdit } from '../src/structure.ts';
import { random } from './random.ts';
import { seededWorkbook } from './generate.ts';
import { Replica } from './harness.ts';
import type { IDocumentData, IRange, IWorkbookData } from '@univerjs/core';

/** Makes one random edit from a replica's current state, or null to skip a turn. */
export type Generate = (replica: Replica, next: () => number) => Mutation[] | null;

/** Each cell's keys, by `sheet:row:col`, as `stateOf` reads them. */
type State = Map<string, Keys>;
type Keys = Map<string, string>;
/**
 * A replica's keys, each with what wrote it: `seed`, `client:n` for the nth
 * mutation a client made, or `#i` for the history's ith edit as a client
 * applied it.
 */
type Facts = Map<string, Map<string, Fact>>;
type Fact = { value: string; by: string };
/** Where a cell's content is: a cell, null once deleted, undefined once dragged nowhere. */
type Place = string | null | undefined;

/** What an edit wrote or changed where it landed (see `written`), and the keys there after. */
type Landed = { touched: Set<string>; after: State };
/** A replica, with the keys it holds. */
interface Site {
  replica: Replica;
  facts: Facts;
}

/**
 * A mutation a client made, `label` (see `Facts`), and what transforms have
 * made of it since. Its sender had applied the first `revision` edits of the
 * history when it made it: those, and its sender's own earlier mutations, are
 * what it saw.
 */
interface Part {
  label: string;
  revision: number;
  mutations: Mutation[];
}

const flat = (parts: Part[]) => parts.flatMap((part) => part.mutations);
const sender = (label: string) => label.split(':')[0];

interface Client extends Site {
  revision: number;
  inflight: Part[] | null;
  buffer: Part[];
  /** Server messages not yet delivered, in order: an ack, or another client's edit's history index. */
  inbox: ('ack' | number)[];
  /** Edits sent but not yet received by the server, in order. */
  outbox: { revision: number; parts: Part[] }[];
}

/** A cell, as `sheet:row:col`. */
const at = (sheet: string, row: number, col: number) => `${sheet}:${row}:${col}`;
const parse = (key: string) => {
  const [sheet, row, col] = key.split(':');
  return { sheet, row: Number(row), col: Number(col) };
};

/** Seeded values name their first cell (`s1:0:2`); each text, formula or colour written has a token. */
const tokenPattern = /s\d+:\d+:\d+|[wc]#\d+/g;

const booleans = new Map([
  ['true', '1'],
  ['false', '0'],
]);

/**
 * Each key `replica` holds, by cell: `s` as `s.<key>` for each style key, and
 * no `t`, which Univer derives. A value reads as its text, as a text format
 * types it, and rich text as its text, which a style restyles. With `where`,
 * throws if a token is in two cells: moves move content, and nothing copies it.
 */
function stateOf(replica: Replica, where?: string): State {
  const state: State = new Map();
  const tokens = new Map<string, string>();
  const styles = replica.workbook()!.getStyles();
  const read = (key: string, value: any): [string, string][] => {
    if (value == null || key === 't') return [];
    if (key === 's') {
      const style = typeof value === 'string' ? styles.get(value) : value;
      return Object.entries(style ?? {}).flatMap(([name, v]) =>
        v == null ? [] : [[`s.${name}`, JSON.stringify(v)]],
      );
    }
    // Univer stores TRUE as 1, so a value's type may turn one into the other.
    if (key === 'v') return [['v', booleans.get(String(value).toLowerCase()) ?? String(value)]];
    if (key === 'p') return [['p', String(value.body?.dataStream)]];
    return [[key, JSON.stringify(value)]];
  };
  for (const sheet of replica.workbook()!.getSheets()) {
    sheet.getCellMatrix().forValue((row, col, cell) => {
      const key = at(sheet.getSheetId(), row, col);
      const keys = new Map(
        Object.entries(cell ?? {}).flatMap(([name, value]) => read(name, value)),
      );
      if (keys.size > 0) state.set(key, keys);
      for (const token of [...keys.values()].join(' ').match(tokenPattern) ?? []) {
        const other = tokens.get(token) ?? key;
        if (where && other !== key) throw new Error(`${where}: ${token} is in ${other} and ${key}`);
        tokens.set(token, key);
      }
    });
  }
  return state;
}

const inRange = (r: IRange, row: number, col: number) =>
  row >= r.startRow && row <= r.endRow && col >= r.startColumn && col <= r.endColumn;

/**
 * Where a drag takes each source cell's content: the cell at the same place
 * in `toRange`, while the move still writes it.
 */
function targets(move: Mutation): Map<string, { row: number; col: number }> {
  const { fromRange, toRange, from, to } = move.params;
  const result = new Map<string, { row: number; col: number }>();
  for (const [r, columns] of Object.entries(from.value ?? {})) {
    for (const c of Object.keys(columns ?? {})) {
      const row = Number(r) + toRange.startRow - fromRange.startRow;
      const col = Number(c) + toRange.startColumn - fromRange.startColumn;
      if (to.value?.[row]?.[col] !== undefined) result.set(`${r}:${c}`, { row, col });
    }
  }
  return result;
}

/**
 * Where `mutation` takes the content of a cell: to the same cell or another,
 * to null where it deletes the cell, or to undefined where a drag takes it to
 * no target, as when a concurrent edit removed the target. A shift moves the
 * cells of its band, written or not, as far as its ranges reach, and deletes
 * those in the lines it removes.
 */
function follower(mutation: Mutation): (cell: string) => Place {
  const p = mutation.params;
  const line = axisEdit(mutation);
  const shift = line ? { axis: line.axis, ...line.edit } : shiftOf(mutation);
  const drag = !shift && mutation.id === cellIds.moveRange && targets(mutation);
  if (!shift && !drag) return (cell) => cell;
  return (cell) => {
    const { sheet, row, col } = parse(cell);
    if (sheet !== (line ? p.subUnitId : p.from.subUnitId)) return cell;
    if (drag) {
      if (p.from.value[row]?.[col] === undefined) return cell;
      const target = drag.get(`${row}:${col}`);
      return target && at(p.to.subUnitId, target.row, target.col);
    }
    const [index, across] = shift!.axis === 'row' ? [row, col] : [col, row];
    if (!line) {
      const { fromRange: band } = p;
      const [first, last] =
        shift!.axis === 'row' ? [band.startColumn, band.endColumn] : [band.startRow, band.endRow];
      if (across < first || across > last) return cell;
      const removed =
        shift!.kind === 'remove' && index >= shift!.at && index < shift!.at + shift!.count;
      if (!removed && !inRange(band, row, col) && !inRange(p.toRange, row, col)) return cell;
    }
    const moved = mapIndex(shift!, index);
    if (moved === null) return null;
    return shift!.axis === 'row' ? at(sheet, moved, col) : at(sheet, row, moved);
  };
}

/**
 * The keys `mutation` writes in each cell: '' for a whole cell
 * (a null write or a drag's), `s` for a whole style. A shift moves cells and
 * writes none, and a retype writes again what the cell holds.
 */
function written(mutation: Mutation): { cell: string; key: string }[] {
  const p = mutation.params;
  const cells = Object.values(cellIds) as string[];
  if (!cells.includes(mutation.id) || shiftOf(mutation) || p.derived) return [];
  // A move's two matrices are on one sheet: transform rejects one across sheets.
  const move = mutation.id === cellIds.moveRange;
  return writesOf(mutation).flatMap(({ row, col, value }) => {
    const cell = at(move ? p.from.subUnitId : p.subUnitId, row, col);
    if (mutation.id !== cellIds.setRangeValues) return [{ cell, key: move ? '' : 's.n' }];
    if (value === null) return [{ cell, key: '' }];
    return Object.entries(value).flatMap(([key, v]) => {
      if (v === undefined || key === 't') return [];
      if (key !== 's' || v === null || p.isOverrideStyle) return [{ cell, key }];
      return Object.keys(v as object).map((name) => ({ cell, key: `s.${name}` }));
    });
  });
}

/** Whether `touched`, as `cell|key` (see `written`), holds `key` of `cell`. */
const covered = (touched: Set<string>, cell: string, key: string) =>
  touched.has(`${cell}|${key}`) ||
  touched.has(`${cell}|`) ||
  (key.startsWith('s.') && touched.has(`${cell}|s`));

/** `touched` (see `covered`), with each cell where `mutations` take it. */
function moved(touched: Iterable<string>, mutations: Mutation[]): string[] {
  const follows = mutations.map(follower);
  return [...touched].flatMap((entry) => {
    const [cell, key] = entry.split('|');
    const here = follows.reduce<Place>((place, follow) => place && follow(place), cell);
    return here ? [`${here}|${key}`] : [];
  });
}

/** Throws if a cell's keys `x` and the server's `y` differ in a key `named` picks. */
function compare(x?: Keys, y?: Keys, where = '', named: (key: string) => boolean = () => true) {
  for (const key of new Set([...(x?.keys() ?? []), ...(y?.keys() ?? [])])) {
    if (!named(key) || x?.get(key) === y?.get(key)) continue;
    throw new Error(`${where}: ${key} is ${x?.get(key)}, and ${y?.get(key)} on the server`);
  }
}

/** What `simulate` counts (see its doc). */
export type Stats = ReturnType<typeof newStats>;
export const newStats = () => ({
  edits: 0,
  mutations: 0,
  batches: 0,
  accepted: 0,
  refused: 0,
  resynced: 0,
  discarded: 0,
});

/**
 * The README's sender rules take a refusal for moved cells or a format race
 * to refuse the other order too, whichever edit lands first. Growth depends
 * on the order, so it is not checked.
 */
function refusedBothWays(error: unknown, a: Mutation[], b: Mutation[], side: Side) {
  if (!(error instanceof RefusedEditError) || error.reason === 'growth') return;
  try {
    transformAll(b, a, flip(side));
  } catch (other) {
    if (other instanceof RefusedEditError) return;
  }
  throw new Error(
    `${a.length} past ${b.length} was refused (${error.reason}), the other order not`,
  );
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
 * With `intent`, for cell edits only, it also checks the edits keep what they
 * should. Each replica holds every key of every cell (see `stateOf`) with
 * what wrote it (see `Facts`), and follows the cell as rows, columns, shifts
 * and drags move it, so each key an edit writes is held from then on. Then:
 * - No token is ever in two cells of a replica.
 * - The server lands each mutation a client made on its own, as transforms
 *   made it (see `Part`). Each key held keeps its value unless the mutation
 *   deletes its cell or saw the key: its writer was accepted before the
 *   mutation's revision, or is its sender's earlier mutation, whose key it
 *   changed on its sender too. History wins, even over a mutation that was
 *   transformed past it on its sender before it was sent.
 * - On a client, an incoming edit changes only keys it changed on the server
 *   (see `written`), in the cells the pending edits, landing after it there,
 *   take them to, and they must then be as on the server.
 * - A client whose edit is acknowledged, with none pending, holds the server's.
 * A retype (`derived`) writes again what was written and loses to any edit,
 * so it writes no key.
 *
 * `stats` counts the edits made (`edits`, one per `generate` call, and
 * `mutations`), the batches that reached the server (`batches`), those it
 * accepted and refused, the clients that resynced because an incoming edit
 * could not pass their pending ones (`resynced`), and the pending mutations
 * that refusals and resyncs discarded (`discarded`).
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
    let result: Mutation[];
    try {
      result = transformAll(a, b, side);
    } catch (error) {
      refusedBothWays(error, a, b, side);
      throw error;
    }
    const inputs = a.length + b.length;
    largest = Math.max(largest, result.length / Math.max(inputs, 1));
    if (options.budget !== undefined && result.length > options.budget * inputs) {
      throw new Error(`${a.length} mutations past ${b.length} became ${result.length}`);
    }
    return result;
  };
  const intent = options.intent;
  /**
   * Transforms `parts` past `b`, keeping what each became: transform pairs
   * mutations up in order, so the first n parts become the start of the whole.
   */
  const pastParts = (parts: Part[], b: Mutation[], side: Side): Part[] => {
    const all = transform(flat(parts), b, side);
    if (!intent) return [{ ...parts[0], mutations: all }];
    let [done, prefix] = [0, [] as Mutation[]];
    return parts.map((part, i) => {
      prefix = [...prefix, ...part.mutations];
      const upTo = i === parts.length - 1 ? all : transformAll(prefix, b, side);
      if (JSON.stringify(upTo) !== JSON.stringify(all.slice(0, upTo.length))) {
        throw new Error(`${part.label} became no start of its batch's transform`);
      }
      const start = done;
      done = upTo.length;
      return { ...part, mutations: all.slice(start, done) };
    });
  };
  const server: Site = { replica: new Replica(options.document), facts: new Map() };
  const history: ({ mutations: Mutation[] } & Landed)[] = [];
  /** Each client mutation's history index; the seeded document's is -1. */
  const acceptedAt = new Map([['seed', -1]]);
  const indexOf = (by: string) =>
    by.startsWith('#') ? Number(by.slice(1)) : (acceptedAt.get(by) ?? Infinity);
  /**
   * The keys each client mutation changed on its sender, as `key|value`:
   * writers differ where replicas held a value before it was written again.
   */
  const changes = new Map<string, Set<string>>();
  let made = 0;
  const stats = newStats();
  /**
   * Applies `mutations`, which `by` made, to `site`, and checks the
   * keys it held as `simulate` says, `mayChange` allowing changes. Returns
   * the keys the mutations wrote or changed (see `written`), and the state.
   */
  const land = (
    site: Site,
    mutations: Mutation[],
    by: string,
    where: string,
    mayChange: (fact: Fact, cell: string, key: string) => boolean = () => true,
  ): Landed => {
    site.replica.apply(mutations);
    if (!intent) return { touched: new Set(), after: new Map() };
    const held = [...site.facts].flatMap(([cell, keys]) =>
      [...keys].map(([key, fact]) => ({ cell: cell as Place, last: cell, key, fact })),
    );
    const wrote: { cell: Place; key: string }[] = [];
    for (const mutation of mutations) {
      const follow = follower(mutation);
      for (const entry of [...held, ...wrote]) entry.cell &&= follow(entry.cell);
      for (const entry of held) entry.last = entry.cell || entry.last;
      wrote.push(...written(mutation));
    }
    const after = stateOf(site.replica, where);
    const kept: Facts = new Map();
    const keep = (cell: string, key: string, fact: Fact) =>
      kept.set(cell, (kept.get(cell) ?? new Map()).set(key, fact));
    const touched = new Set(wrote.flatMap(({ cell, key }) => (cell ? [`${cell}|${key}`] : [])));
    for (const { cell, last, key, fact } of held) {
      if (cell === null) continue;
      const value = cell && after.get(cell)?.get(key);
      if (value === fact.value) {
        // Written again by an edit before its writer, it is that edit's.
        const again = covered(touched, cell!, key) && indexOf(by) < indexOf(fact.by);
        keep(cell!, key, again ? { value, by } : fact);
        continue;
      }
      touched.add(`${last}|${key}`);
      if (mayChange(fact, last, key)) continue;
      throw new Error(`${where}: ${key} of ${last} by ${fact.by}, ${fact.value}, is now ${value}`);
    }
    for (const [cell, keys] of after) {
      for (const [key, value] of keys) {
        if (kept.get(cell)?.has(key)) continue;
        keep(cell, key, { value, by });
        touched.add(`${cell}|${key}`);
      }
    }
    site.facts = kept;
    return { touched, after };
  };
  const seeded = land(server, [], 'seed', 'seeded').after;
  const clients: Client[] = [0, 1].map(() => ({
    replica: new Replica(options.document),
    facts: server.facts,
    revision: 0,
    inflight: null,
    buffer: [],
    inbox: [],
    outbox: [],
  }));
  /** The server's keys after the first `revision` edits. */
  const stateAt = (revision: number) => (revision === 0 ? seeded : history[revision - 1].after);

  const send = (client: Client) => {
    if (client.inflight || client.buffer.length === 0) return;
    client.inflight = client.buffer;
    client.buffer = [];
    client.outbox.push({ revision: client.revision, parts: client.inflight });
  };
  /**
   * Refuses `client`'s pending edits: it discards them and reloads the
   * server's document, which holds every message still on its way to it. The
   * document is rebuilt from the server's history, as the server's was.
   */
  const resync = (client: Client) => {
    // An acknowledged batch is in the server's history, so the reload keeps it.
    const acknowledged = client.inbox.includes('ack');
    const inflight = acknowledged ? [] : (client.inflight ?? []);
    stats.discarded += flat([...inflight, ...client.buffer]).length;
    client.replica.univer.dispose();
    client.replica = new Replica(options.document);
    for (const { mutations } of history) client.replica.apply(mutations);
    Object.assign(client, { revision: history.length, inflight: null, buffer: [] });
    client.facts = server.facts;
    client.inbox.length = 0;
    client.outbox.length = 0;
  };
  /**
   * Runs `transforms`, or resyncs `client` if they refuse, counted as a
   * refusal at the server and as a resync at a client.
   */
  const transformOr = <T>(client: Client, count: 'refused' | 'resynced', transforms: () => T) => {
    try {
      return transforms();
    } catch (error) {
      if (!(error instanceof RefusedEditError)) throw error;
      stats[count]++;
      resync(client);
      return null;
    }
  };
  const receiveAtServer = (from: Client) => {
    const { revision, parts } = from.outbox.shift()!;
    stats.batches++;
    let incoming: Part[] | null = parts;
    for (const { mutations } of history.slice(revision)) {
      incoming = transformOr(from, 'refused', () => pastParts(incoming!, mutations, 'right'));
      if (!incoming) return;
    }
    stats.accepted++;
    const index = history.length;
    for (const { label } of incoming) acceptedAt.set(label, index);
    const where = `server at ${index}`;
    // Each mutation changes only keys it saw: the edits accepted since lose nothing to it.
    let { touched, after } = { touched: new Set<string>(), after: stateAt(index) };
    for (const { label, revision: saw, mutations } of incoming) {
      if (mutations.length === 0) continue;
      const landed = land(server, mutations, label, where, ({ by, value }, _cell, key) => {
        if (indexOf(by) < saw) return true;
        return sender(by) === sender(label) && !!changes.get(label)?.has(`${key}|${value}`);
      });
      touched = new Set([...moved(touched, mutations), ...landed.touched]);
      after = landed.after;
    }
    history.push({ mutations: flat(incoming), touched, after });
    for (const client of clients) client.inbox.push(client === from ? 'ack' : index);
  };
  const receiveAtClient = (client: Client) => {
    const message = client.inbox.shift()!;
    const where = `client ${clients.indexOf(client)} at ${client.revision++}`;
    if (message === 'ack') {
      client.inflight = null;
      if (intent && client.buffer.length === 0) {
        const [here, there] = [stateOf(client.replica), stateAt(client.revision)];
        for (const cell of new Set([...here.keys(), ...there.keys()])) {
          compare(here.get(cell), there.get(cell), `${where}, acknowledged: ${cell}`);
        }
      }
      send(client);
      return;
    }
    const { mutations, touched } = history[message];
    let incoming = mutations;
    for (const key of ['inflight', 'buffer'] as const) {
      const pending = client[key];
      if (!pending || pending.length === 0) continue;
      // The server refuses the pending edits for the same reason. Where only
      // the incoming edit cannot go past them, the client cannot apply it
      // and resyncs as well.
      const kept = transformOr(client, 'resynced', () => pastParts(pending, incoming, 'right'));
      const past =
        kept && transformOr(client, 'resynced', () => transform(incoming, flat(pending), 'left'));
      if (!kept || !past) return;
      client[key] = kept;
      incoming = past;
    }
    // What the incoming edit wrote on the server, in the cells the pending
    // edits, landing after it there, take it to here.
    const follows = flat([...(client.inflight ?? []), ...client.buffer]).map(follower);
    const [there, mine] = [new Map<string, string>(), new Set<string>()];
    for (const entry of intent ? touched : []) {
      const [cell, key] = entry.split('|');
      let here: Place = cell;
      for (const follow of follows) here &&= follow(here);
      if (!here) continue;
      mine.add(`${here}|${key}`);
      there.set(here, cell);
    }
    const landed = land(client, incoming, `#${message}`, where, (_fact, cell, key) =>
      covered(mine, cell, key),
    );
    for (const [here, cell] of there) {
      const keys = stateAt(message + 1).get(cell);
      compare(landed.after.get(here), keys, `${where}: ${here}`, (key) => covered(mine, here, key));
    }
  };

  let edits = 0;
  while (edits < options.edits) {
    const client = clients[next() % 2];
    const roll = next() % 10;
    if (roll < 4) {
      const mutations = options.generate(client.replica, next);
      if (!mutations || mutations.length === 0) continue;
      const name = clients.indexOf(client);
      for (const mutation of mutations) {
        const [label, changed] = [`${name}:${made++}`, new Set<string>()];
        changes.set(label, changed);
        land(client, [mutation], label, `client ${name}`, ({ value }, _cell, key) => {
          changed.add(`${key}|${value}`);
          return true;
        });
        client.buffer.push({ label, revision: client.revision, mutations: [mutation] });
      }
      edits += mutations.length;
      stats.edits++;
      stats.mutations += mutations.length;
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
  return {
    server: server.replica,
    clients: clients.map((client) => client.replica),
    edits,
    largest,
    stats,
  };
}

/**
 * Runs `simulate` for seeds 1 to `seeds`, or only `FUZZ_SEED` when set, and
 * checks every client ends with the server's document. A failure names its
 * seed. Returns the number of mutations made, and adds each seed's counts to
 * `stats` if given.
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
    stats,
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
    /** Summed over the seeds. */
    stats?: Stats;
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
    for (const key of Object.keys(run.stats) as (keyof Stats)[]) {
      if (stats) stats[key] += run.stats[key];
    }
  }
  return total;
}
