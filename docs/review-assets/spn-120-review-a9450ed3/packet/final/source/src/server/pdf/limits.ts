import type { PrintLimits } from '@spinel/print';

const MiB = 1024 * 1024;

/** One worker, with preparation and response held under the shared transfer lease. */
export const PDF_LIMITS = Object.freeze({
  snapshotBytes: 8 * MiB,
  snapshotNodes: 150_000,
  worksheets: 32,
  rows: 50_000,
  columns: 2_048,
  cells: 50_000,
  textCharacters: 250_000,
  gridCells: 200_000,
  merges: 2_000,
  mergeCells: 200_000,
  images: 32,
  encodedImageBytes: 8 * MiB,
  decodedImagePixels: 8_000_000,
  fonts: 17,
  fontBytes: 12 * MiB,
  pages: 100,
  outputBytes: 16 * MiB,
  durationMs: 25_000,
} satisfies PrintLimits);

export const PDF_DEADLINE_MS = 30_000;
export const PDF_WORKER_RSS_BYTES = 640 * MiB;
// Includes the parent and all its Formula worker threads. Keep 512 MiB for the
// OS and transient allocations on the 2 GiB host; sampled RSS is not a cgroup.
export const PDF_COMBINED_RSS_BYTES = 1536 * MiB;
export const PDF_MEMORY_SAMPLE_MS = 100;

export type PdfErrorCode = 'busy' | 'limit' | 'cancelled' | 'unsupported' | 'failed';

export class PdfError extends Error {
  readonly code: PdfErrorCode;
  constructor(code: PdfErrorCode) {
    const messages: Record<PdfErrorCode, string> = {
      busy: 'Another PDF is being prepared. Try again shortly.',
      limit: 'This file exceeds the PDF export limit.',
      cancelled: 'PDF export was cancelled.',
      unsupported: 'This file contains formatting or text that cannot be exported as PDF yet.',
      failed: 'Could not create a complete PDF. Try again.',
    };
    super(messages[code]);
    this.name = 'PdfError';
    this.code = code;
  }
}
