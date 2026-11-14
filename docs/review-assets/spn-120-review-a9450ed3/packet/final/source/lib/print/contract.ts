/** Resource admission, not a promise that an in-process native call is interruptible. */
export interface PrintLimits {
  snapshotBytes: number;
  snapshotNodes: number;
  worksheets: number;
  rows: number;
  columns: number;
  cells: number;
  textCharacters: number;
  gridCells: number;
  merges: number;
  mergeCells: number;
  images: number;
  encodedImageBytes: number;
  decodedImagePixels: number;
  fonts: number;
  fontBytes: number;
  pages: number;
  outputBytes: number;
  durationMs: number;
}

/** Callers may lower these limits, never raise the package's admission ceiling. */
export const PRINT_LIMITS: Readonly<PrintLimits> = Object.freeze({
  snapshotBytes: 16 * 1024 * 1024,
  snapshotNodes: 250_000,
  worksheets: 32,
  rows: 50_000,
  columns: 2_048,
  cells: 50_000,
  textCharacters: 250_000,
  gridCells: 250_000,
  merges: 2_000,
  mergeCells: 250_000,
  images: 128,
  encodedImageBytes: 32 * 1024 * 1024,
  decodedImagePixels: 32_000_000,
  // Four complete static families plus one regular symbol face; bytes stay capped.
  fonts: 17,
  fontBytes: 32 * 1024 * 1024,
  pages: 100,
  outputBytes: 64 * 1024 * 1024,
  durationMs: 30_000,
});

export type PrintErrorCode = 'invalid-input' | 'limit' | 'cancelled' | 'unsupported' | 'cleanup';

/** Messages intentionally contain no workbook names, cell values, image URLs or bytes. */
export class PrintError extends Error {
  readonly code: PrintErrorCode;
  constructor(code: PrintErrorCode, message: string) {
    super(message);
    this.name = 'PrintError';
    this.code = code;
  }
}

export interface SheetPrintOptions {
  /** A set, not an ordering override. Hidden sheets are always omitted. */
  worksheetIds?: readonly string[];
  limits?: Partial<PrintLimits>;
  signal?: AbortSignal;
}

export interface PreparedImage {
  /** Exact native source reference. This is an opaque lookup key, never fetched. */
  source: string;
  bytes: Uint8Array;
}

export interface PreparedFont {
  family: string;
  aliases?: readonly string[];
  weight: 400 | 700;
  italic: boolean;
  bytes: Uint8Array;
  /** Caller attests the redistribution/embedding license; nothing is fetched. */
  license: { identifier: string; text: string; source: string };
}

export interface PrintBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SheetPrintPage {
  sheetId: string;
  /** Contiguous layout-space slice; a tall cell/merge/image continues on the next page. */
  source: PrintBox;
  /** PDF points per layout pixel, never greater than 72/96. */
  scale: number;
}

export function printLimits(options: SheetPrintOptions): Readonly<PrintLimits> {
  const limits = { ...PRINT_LIMITS };
  for (const [key, value] of Object.entries(options.limits ?? {})) {
    if (!Object.hasOwn(PRINT_LIMITS, key))
      throw new PrintError('invalid-input', 'Unknown PDF resource limit.');
    const name = key as keyof PrintLimits;
    if (!Number.isSafeInteger(value) || value <= 0 || value > PRINT_LIMITS[name])
      throw new PrintError(
        'invalid-input',
        'PDF limits must be positive and within package bounds.',
      );
    limits[name] = value;
  }
  return Object.freeze(limits);
}

export function printCheckpoint(signal: AbortSignal | undefined, deadline: number) {
  if (signal?.aborted) throw new PrintError('cancelled', 'PDF rendering was cancelled.');
  if (performance.now() >= deadline)
    throw new PrintError('limit', 'PDF rendering exceeded its time limit.');
}
