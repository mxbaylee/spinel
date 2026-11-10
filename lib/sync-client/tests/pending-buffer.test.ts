import { describe, expect, test } from 'vitest';
import type { Mutation } from '@spinel/sync-transform';
import { encodedBytes } from '../src/budget.ts';
import { PendingBuffer } from '../src/pending-buffer.ts';
import { write } from './fixture.ts';

// ASCII, 2-byte, 3-byte (CJK), 4-byte (emoji, a surrogate pair) and escaped characters.
const ALPHABET = ['a', 'z', 'é', '漢', '字', '😀', '🧑‍💻', '"', '\\', '\n', ' '];

function rng(seed: number) {
  let state = seed >>> 0;
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  return {
    below: (n: number) => next() % n,
    pick: <T>(items: readonly T[]) => items[next() % items.length],
  };
}

function group(random: ReturnType<typeof rng>): Mutation[] {
  const count = 1 + random.below(3);
  return Array.from({ length: count }, (_, index) => {
    let text = '';
    for (let n = random.below(12); n > 0; n--) text += random.pick(ALPHABET);
    return write({ v: text }, random.below(50), index);
  });
}

const groups = (random: ReturnType<typeof rng>) =>
  Array.from({ length: random.below(6) }, () => group(random));

describe('PendingBuffer', () => {
  test('an empty buffer is the two bytes of []', () => {
    const buffer = new PendingBuffer();
    expect(buffer.bytes).toBe(2);
    expect(buffer.length).toBe(0);
    expect(buffer.groups).toEqual([]);
  });

  test('size counts UTF-8 bytes, not code units', () => {
    const buffer = new PendingBuffer();
    const first = [write({ v: '😀漢é' })];
    const second = [write({ v: '🧑‍💻' })];
    buffer.push(first);
    buffer.push(second);
    const expected = encodedBytes([first, second]);
    expect(buffer.bytes).toBe(expected);
    expect(JSON.stringify([first, second]).length).toBeLessThan(expected);
    expect(buffer.bytesWith(encodedBytes(first))).toBe(encodedBytes([first, second, first]));
  });

  test('push accepts the caller-measured size and drain returns what it removed', () => {
    const buffer = new PendingBuffer();
    const items = [[write({ v: 'a' })], [write({ v: '漢' })], [write({ v: '😀' })]];
    for (const item of items) buffer.push(item, encodedBytes(item));
    expect(buffer.drain(2)).toEqual(items.slice(0, 2));
    expect(buffer.groups).toEqual(items.slice(2));
    expect(buffer.bytes).toBe(encodedBytes(items.slice(2)));
    expect(buffer.drain(0)).toEqual([]);
    expect(buffer.drain(99)).toEqual(items.slice(2));
    expect(buffer.bytes).toBe(2);
  });

  test('replace swaps the contents, including with an empty list', () => {
    const buffer = new PendingBuffer();
    buffer.push([write({ v: 'old' })]);
    const next = [[write({ v: '漢字' })], [write({ v: '😀' })]];
    buffer.replace(next);
    expect(buffer.length).toBe(2);
    expect(buffer.bytes).toBe(encodedBytes(next));
    buffer.push([write({ v: 'after' })]);
    expect(buffer.bytes).toBe(encodedBytes(buffer.groups));
    buffer.replace([]);
    expect(buffer.bytes).toBe(2);
  });

  test('bytes always equals a full re-encode across random push, drain and replace', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const random = rng(seed);
      const buffer = new PendingBuffer();
      for (let step = 0; step < 60; step++) {
        const action = random.below(10);
        if (action < 5) {
          // Half the pushes pass a measured size, half leave the buffer to measure.
          const item = group(random);
          if (random.below(2)) buffer.push(item, encodedBytes(item));
          else buffer.push(item);
        } else if (action < 8) {
          buffer.drain(random.below(buffer.length + 2));
        } else {
          buffer.replace(groups(random));
          // Sometimes read right away, sometimes let the next op find it unmeasured.
          if (random.below(2)) expect(buffer.bytes).toBe(encodedBytes(buffer.groups));
        }
        expect(buffer.bytes).toBe(encodedBytes(buffer.groups));
        expect(buffer.length).toBe(buffer.groups.length);
        const probe = group(random);
        expect(buffer.bytesWith(encodedBytes(probe))).toBe(encodedBytes([...buffer.groups, probe]));
      }
    }
  });

  test('a push whose size cannot be measured leaves the buffer untouched', () => {
    const buffer = new PendingBuffer();
    const kept = [write({ v: '漢' })];
    buffer.push(kept);
    const cyclic: Mutation[] = [];
    cyclic.push(cyclic as unknown as Mutation);
    expect(() => buffer.push(cyclic)).toThrow();
    expect(buffer.groups).toEqual([kept]);
    expect(buffer.length).toBe(1);
    expect(buffer.bytes).toBe(encodedBytes([kept]));
    buffer.push(kept);
    expect(buffer.bytes).toBe(encodedBytes([kept, kept]));
  });

  test('replace and drain of an unmeasured buffer still measure correctly', () => {
    const buffer = new PendingBuffer();
    buffer.replace([[write({ v: '😀' })], [write({ v: 'b' })], [write({ v: '字' })]]);
    buffer.drain(1);
    expect(buffer.bytes).toBe(encodedBytes(buffer.groups));
    buffer.replace([[write({ v: 'c' })]]);
    buffer.drain(1);
    expect(buffer.bytes).toBe(2);
  });
});
