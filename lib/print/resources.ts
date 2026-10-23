import type { IWorkbookData } from '@univerjs/core';
import { PrintError } from './contract.ts';
import type { PrintLimits } from './contract.ts';
import { inspectSnapshot } from './preflight.ts';

export function resourceRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new PrintError('invalid-input', 'Invalid PDF resource object.');
  return value as Record<string, unknown>;
}

export function readResource(snapshot: IWorkbookData, name: string, limits: Readonly<PrintLimits>, check: () => void): Record<string, unknown> {
  const matches = (snapshot.resources ?? []).filter((resource) => resource.name === name);
  if (!matches.length) return {};
  if (matches.length !== 1 || typeof matches[0].data !== 'string')
    throw new PrintError('invalid-input', 'Duplicate or invalid PDF resource.');
  if (Buffer.byteLength(matches[0].data, 'utf8') > limits.snapshotBytes)
    throw new PrintError('limit', 'PDF resource exceeds its byte budget.');
  check();
  let parsed: unknown;
  try {
    parsed = JSON.parse(matches[0].data);
  } catch {
    throw new PrintError('invalid-input', 'Invalid PDF resource serialization.');
  }
  inspectSnapshot(parsed, limits, check);
  return resourceRecord(parsed);
}
