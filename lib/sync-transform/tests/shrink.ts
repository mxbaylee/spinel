import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { expect } from 'vitest';
import { flip, transform } from '../index.ts';
import type { Mutation, Side } from '../index.ts';
import { cellIds } from '../src/writes.ts';
import { Replica, snapshotCells } from './harness.ts';
import { simulate } from './simulate.ts';
import type { Generate, Step } from './simulate.ts';

type Document = { workbook?: IWorkbookData; doc?: IDocumentData };

/**
 * How a run failed: the screens differ (`divergence`), the intent checks
 * flagged a key or a token (`intent`), a transform passed its budget
 * (`growth`), or something else threw, such as Univer rejecting a
 * transformed mutation (`other`). `key` is the cell key the message names.
 */
export interface Failure {
  kind: 'divergence' | 'intent' | 'growth' | 'other';
  key?: string;
  message: string;
}

/** The kind of `error`, from the messages `simulate` and `expect` throw. */
export function classify(error: unknown): Failure {
  const message = String((error as Error)?.message ?? error);
  const named = (pattern: RegExp) => message.match(pattern)?.[1];
  if (/ mutations past \d+ became /.test(message)) return { kind: 'growth', message };
  if (/ on the server/.test(message)) {
    return { kind: 'divergence', key: named(/: ([\w.]+) is .* on the server/), message };
  }
  if ((error as Error)?.name === 'AssertionError') return { kind: 'divergence', message };
  if (/ is now | is in .* and |no start of its batch/.test(message)) {
    return { kind: 'intent', key: named(/: ([\w.]+) of /), message };
  }
  return { kind: 'other', message };
}

/**
 * Runs `steps` as a script (see `simulate`), then checks every client ends
 * with the server's document, as `convergesOver` does. Returns how it failed,
 * or null.
 */
export function replay(
  document: Document,
  steps: Step[],
  options: { budget?: number; intent?: boolean } = {},
): Failure | null {
  try {
    const run = simulate({
      seed: 1,
      document,
      mutations: 0,
      generate: () => null,
      script: steps,
      ...options,
    });
    try {
      const expected = run.server.snapshot();
      for (const client of run.clients) expect(client.snapshot()).toEqual(expected);
    } finally {
      for (const replica of [run.server, ...run.clients]) replica.univer.dispose();
    }
    return null;
  } catch (error) {
    return classify(error);
  }
}

/**
 * The smallest sublist of `items` that `fails` still holds for, by delta
 * debugging: drop chunks while the rest still fails, halving the chunks when
 * none can go, then drop single items until none can.
 */
function ddmin<T>(items: T[], fails: (kept: T[]) => boolean): T[] {
  let chunks = 2;
  while (items.length >= 2) {
    const size = Math.ceil(items.length / chunks);
    let dropped = false;
    for (let start = 0; start < items.length; start += size) {
      const rest = [...items.slice(0, start), ...items.slice(start + size)];
      if (fails(rest)) {
        items = rest;
        chunks = Math.max(chunks - 1, 2);
        dropped = true;
        break;
      }
    }
    if (dropped) continue;
    if (chunks >= items.length) break;
    chunks = Math.min(items.length, chunks * 2);
  }
  return items;
}

/** `steps` without the edits not in `kept`, which holds indices of edit steps. */
const keeping = (steps: Step[], kept: Set<number>) =>
  steps.filter((step, i) => !('edit' in step) || kept.has(i));

/**
 * Smaller forms of one mutation, for the last pass: a SetRangeValues
 * without one of its cells, or one cell without one of its keys.
 */
function smaller(mutation: Mutation): Mutation[] {
  if (mutation.id !== cellIds.setRangeValues) return [];
  const forms: Mutation[] = [];
  const cells = Object.entries(mutation.params.cellValue ?? {}).flatMap(([row, columns]) =>
    Object.keys(columns ?? {}).map((col) => [row, col] as const),
  );
  const without = (row: string, col: string, value?: unknown) => {
    const params = structuredClone(mutation.params);
    if (value === undefined) {
      delete params.cellValue[row][col];
      if (Object.keys(params.cellValue[row]).length === 0) delete params.cellValue[row];
    } else params.cellValue[row][col] = value;
    return { id: mutation.id, params };
  };
  for (const [row, col] of cells) {
    if (cells.length > 1) forms.push(without(row, col));
    const value = mutation.params.cellValue[row][col];
    if (!value || typeof value !== 'object') continue;
    for (const key of Object.keys(value)) {
      // A forced type comes only with the value it types (see `schemaCell`).
      if (key === 'v' && 't' in value) continue;
      const { [key]: _, ...rest } = value;
      if (Object.keys(rest).length > 0) forms.push(without(row, col, rest));
      // A style keeps one key: an empty one is a shape of its own.
      if (key === 's' && value.s && Object.keys(value.s).length > 1) {
        for (const styleKey of Object.keys(value.s)) {
          const { [styleKey]: __, ...s } = value.s;
          forms.push(without(row, col, { ...value, s }));
        }
      }
    }
  }
  if (mutation.params.isOverrideStyle) {
    const { isOverrideStyle: _, ...params } = mutation.params;
    forms.push({ id: mutation.id, params });
  }
  return forms;
}

/**
 * The two clients' mutations of `steps` as one pair, `a` (client 0) and `b`
 * (client 1), if both orders replay successfully but their snapshots differ
 * on some side. Undefined if collapsing the script into a pair cannot be
 * replayed, and null if no divergent pair is found.
 */
function asPair(document: Document, steps: Step[]) {
  const of = (client: number) =>
    steps.flatMap((step) => ('edit' in step && step.client === client ? step.edit : []));
  const [a, b] = [of(0), of(1)];
  if (a.length === 0 || b.length === 0) return null;
  const cells = snapshotCells(document.workbook);
  for (const side of ['left', 'right'] as Side[]) {
    const [x, y] = [new Replica(document), new Replica(document)];
    try {
      x.apply([...b, ...transform(a, b, side, { cells })]);
      y.apply([...a, ...transform(b, a, flip(side), { cells })]);
      const [left, right] = [x.snapshot(), y.snapshot()];
      try {
        expect(left).toEqual(right);
      } catch {
        return { a, b, side };
      }
    } catch {
      // Collapsing a script can invalidate its edits or turn them into a
      // refused race. That is not evidence of different landed snapshots;
      // shrinkSeed still reports the replayed script's classified failure.
      return undefined;
    } finally {
      x.univer.dispose();
      y.univer.dispose();
    }
  }
  return null;
}

/**
 * A failing seed's run, recorded and replayed with as little as still fails
 * the same way (the same kind and key, see `Failure`): delta debugging over
 * its edits, then each step, then each mutation, cell, key and style key
 * that can go. Returns the failure, the minimal steps, and the pair of
 * clients' mutations where those two alone already diverge. Null if the seed
 * passes.
 */
export function shrinkSeed(options: {
  seed: number;
  document: Document;
  mutations: number;
  generate: Generate;
  budget?: number;
  intent?: boolean;
}) {
  const { seed, document, mutations, generate, ...checks } = options;
  const trace: Step[] = [];
  let failure: Failure | null;
  try {
    const run = simulate({ seed, document, mutations, generate, trace, ...checks });
    for (const replica of [run.server, ...run.clients]) replica.univer.dispose();
    failure = replay(document, trace, checks);
  } catch (error) {
    failure = classify(error);
  }
  if (!failure) return null;
  // The trace replays the run, so a run that fails is one its replay fails.
  const original = failure;
  const same = (steps: Step[]) => {
    const found = replay(document, steps, checks);
    return found?.kind === original.kind && found.key === original.key;
  };
  if (!same(trace)) return { seed, failure, replayed: replay(document, trace, checks) };
  const edits = trace.flatMap((step, i) => ('edit' in step ? [i] : []));
  let steps = keeping(trace, new Set(ddmin(edits, (kept) => same(keeping(trace, new Set(kept))))));
  steps = ddmin(steps, same);
  // Each mutation of each edit, then the parts of each that are left.
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!('edit' in step)) continue;
    const at = (edit: Mutation[]) => steps.map((s, j) => (j === i ? { ...step, edit } : s));
    let edit = ddmin(step.edit, (kept) => kept.length > 0 && same(at(kept)));
    for (let m = 0; m < edit.length; m++) {
      for (;;) {
        const found = smaller(edit[m]).find((candidate) =>
          same(at(edit.map((x, n) => (n === m ? candidate : x)))),
        );
        if (!found) break;
        edit = edit.map((x, n) => (n === m ? found : x));
      }
    }
    steps = at(edit);
  }
  return {
    seed,
    failure: replay(document, steps, checks),
    steps,
    pair: asPair(document, steps),
  };
}
