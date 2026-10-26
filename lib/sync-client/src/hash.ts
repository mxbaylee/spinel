import {
  canonical,
  inlineSnapshotCell,
  normalizedCell,
  normalizedDocBody,
} from '@spinel/sync-transform';
import type { IDocumentData, IWorkbookData } from '@univerjs/core';
import { ClientError, MAX_PENDING_BYTES } from './types.ts';
import type { NativeSnapshot, Touched } from './types.ts';

const encoder = new TextEncoder();
export const encodedBytes = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength;

/** Charge expanded values before cloning them or retaining a lazy cell cache. */
export function byteBudget(limit = MAX_PENDING_BYTES) {
  let remaining = limit;
  return (value: unknown) => {
    remaining -= encodedBytes(value);
    if (remaining < 0) throw new ClientError('capacity');
  };
}

/** Same canonical SHA-256 input and expansion budget as the server's touched hash. */
export async function hashTouched(snapshot: NativeSnapshot, touched: Touched): Promise<string> {
  let input: string;
  if (touched.kind === 'doc') {
    byteBudget()((snapshot as IDocumentData).body ?? null);
    input = canonical(normalizedDocBody((snapshot as IDocumentData).body));
    if (encoder.encode(input).byteLength > MAX_PENDING_BYTES) throw new ClientError('capacity');
  } else {
    let remaining = MAX_PENDING_BYTES;
    const charge = (value: unknown) => {
      const json = JSON.stringify(value);
      remaining -= encoder.encode(json).byteLength;
      if (remaining < 0) throw new ClientError('capacity');
      return json;
    };
    const addresses = touched.cells.map((address) => ({
      id: charge([address.sheetId, address.row, address.column]),
      address,
    }));
    addresses.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    input =
      '[' +
      addresses
        .map(({ address }) => {
          charge(address);
          const cell = inlineSnapshotCell(snapshot as IWorkbookData, address);
          charge(cell);
          return canonical({ ...address, value: normalizedCell(cell) });
        })
        .join(',') +
      ']';
  }
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
}
