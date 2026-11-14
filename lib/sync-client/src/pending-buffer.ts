import type { Mutation } from '@spinel/sync-transform';
import { encodedBytes } from './budget.ts';

type Group = Mutation[];

/**
 * Unsent mutation groups plus the exact JSON byte size of that array.
 * The size is kept incrementally so queuing one more group never re-encodes the
 * rest. Every mutation of the groups goes through this class, which is the only
 * place that can leave the cache stale.
 */
export class PendingBuffer {
  #groups: Group[] = [];
  /** Encoded size of each group; undefined after `replace` until first needed. */
  #sizes: number[] | undefined = [];
  /** Sum of `#sizes`; valid only while `#sizes` is defined. */
  #sum = 0;

  get groups(): readonly Group[] {
    return this.#groups;
  }

  get length(): number {
    return this.#groups.length;
  }

  /** Byte size of `encodedBytes(groups)`: `[]` is 2, otherwise group bytes + commas + 2. */
  get bytes(): number {
    return this.#total() + 2 + Math.max(0, this.#groups.length - 1);
  }

  /** What `bytes` would be after `push` of a group of `groupBytes` bytes. */
  bytesWith(groupBytes: number): number {
    return this.#total() + groupBytes + 2 + this.#groups.length;
  }

  /** `groupBytes` must be `encodedBytes(group)`; measured here when omitted. */
  push(group: Group, groupBytes: number = encodedBytes(group)): void {
    const total = this.#total();
    this.#groups.push(group);
    this.#sizes!.push(groupBytes);
    this.#sum = total + groupBytes;
  }

  /** Remove and return the first `count` groups. */
  drain(count: number): Group[] {
    const removed = this.#groups.splice(0, count);
    if (this.#sizes) {
      for (const size of this.#sizes.splice(0, removed.length)) this.#sum -= size;
    }
    return removed;
  }

  replace(groups: Group[]): void {
    this.#groups = groups;
    this.#sizes = undefined;
    this.#sum = 0;
  }

  #total(): number {
    if (!this.#sizes) {
      this.#sizes = this.#groups.map((group) => encodedBytes(group));
      this.#sum = this.#sizes.reduce((sum, size) => sum + size, 0);
    }
    return this.#sum;
  }
}
