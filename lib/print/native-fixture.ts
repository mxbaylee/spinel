/** Test child process only: native font registries may be shared by JS workers. */
import { GlobalFonts } from '@napi-rs/canvas';
import type { SheetPrintInput, SheetPrintOptions } from '@spinel/print';

// The standalone-package test supplies an isolated source copy. Ordinary tests
// resolve the same public package name used by future Spinel integration.
const { renderSheetPdf } = await import(process.env.PRINT_PACKAGE_ENTRY ?? '@spinel/print');

export interface NativeJob {
  input: SheetPrintInput;
  options?: Omit<SheetPrintOptions, 'signal'>;
  abort?: boolean;
  abortDuringPrepare?: boolean;
  abortDuringCleanup?: boolean;
  /** Test-only failure of the public cleanup API, after native work has run. */
  failCleanup?: boolean;
}

export interface NativeResult {
  ok: boolean;
  bytes?: Uint8Array;
  pages?: number;
  code?: string;
  message?: string;
  restored: boolean;
  remainingFonts: number;
  metrics: {
    durationMs: number;
    maxRssKiB: number;
    heapUsedBytes: number;
    externalBytes: number;
  };
}

process.once('message', async (message) => {
  const names = ['OffscreenCanvas', 'Image', 'Path2D'];
  const before = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const results = [];
  for (const job of message as NativeJob[]) {
    const started = performance.now();
    const controller = new AbortController();
    if (job.abort) controller.abort();
    const removeBatch = GlobalFonts.removeBatch;
    if (job.failCleanup) GlobalFonts.removeBatch = () => 0;
    else if (job.abortDuringCleanup)
      GlobalFonts.removeBatch = (keys) => {
        const removed = removeBatch.call(GlobalFonts, keys);
        controller.abort();
        return removed;
      };
    let result;
    try {
      const pending = renderSheetPdf(job.input, {
        ...job.options,
        signal: controller.signal,
      });
      if (job.abortDuringPrepare) queueMicrotask(() => controller.abort());
      result = {
        ok: true,
        ...(await pending),
      };
    } catch (error) {
      result = {
        ok: false,
        code: (error as { code?: string }).code,
        message: error instanceof Error ? error.message : 'Unknown failure',
      };
    } finally {
      GlobalFonts.removeBatch = removeBatch;
    }
    const restored = names.every((name, index) => {
      const current = Object.getOwnPropertyDescriptor(globalThis, name),
        original = before[index];
      return (
        current?.value === original?.value &&
        current?.get === original?.get &&
        current?.set === original?.set &&
        current?.writable === original?.writable &&
        current?.enumerable === original?.enumerable &&
        current?.configurable === original?.configurable
      );
    });
    const memory = process.memoryUsage();
    results.push({
      ...result,
      restored,
      remainingFonts: GlobalFonts.families.length,
      metrics: {
        durationMs: performance.now() - started,
        maxRssKiB: process.resourceUsage().maxRSS,
        heapUsedBytes: memory.heapUsed,
        externalBytes: memory.external,
      },
    });
  }
  if (!process.send || !process.disconnect)
    throw new Error('Native fixture requires an IPC channel.');
  process.send(results);
  process.disconnect();
});
