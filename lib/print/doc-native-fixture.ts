/** Synthetic child-process harness: never used by production renderers. */
import { GlobalFonts } from '@napi-rs/canvas';
import type { DocPrintInput, DocPrintOptions, SheetPrintInput } from './index.ts';
import type { NativeResult } from './native-fixture.ts';

const { renderDocPdf, renderSheetPdf } = await import(
  process.env.PRINT_PACKAGE_ENTRY ?? '@spinel/print'
);

export interface DocNativeJob {
  input: DocPrintInput;
  options?: Omit<DocPrintOptions, 'signal'>;
  abort?: boolean;
  abortDuringPrepare?: boolean;
  abortDuringCleanup?: boolean;
  failCleanup?: boolean;
  overlapSheet?: SheetPrintInput;
}

export interface DocNativeResult extends NativeResult {
  mediaBox?: { width: number; height: number };
  overlapCode?: string;
  debugStack?: string;
}

process.once('message', async (message) => {
  const names = ['OffscreenCanvas', 'Image', 'Path2D'];
  const before = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const results: DocNativeResult[] = [];
  for (const job of message as DocNativeJob[]) {
    const started = performance.now();
    const controller = new AbortController();
    if (job.abort) controller.abort();
    const remove = GlobalFonts.removeBatch;
    if (job.failCleanup) GlobalFonts.removeBatch = () => 0;
    else if (job.abortDuringCleanup)
      GlobalFonts.removeBatch = (keys) => {
        const count = remove.call(GlobalFonts, keys);
        controller.abort();
        return count;
      };
    let result: Partial<DocNativeResult>;
    let overlapCode: string | undefined;
    try {
      const pending = renderDocPdf(job.input, { ...job.options, signal: controller.signal });
      if (job.abortDuringPrepare) queueMicrotask(() => controller.abort());
      if (job.overlapSheet)
        await renderSheetPdf(job.overlapSheet).catch((error: { code?: string }) => {
          overlapCode = error.code;
        });
      result = { ok: true, ...(await pending) };
    } catch (error) {
      result = {
        ok: false,
        code: (error as { code?: string }).code,
        message: error instanceof Error ? error.message : 'Unknown failure',
        ...(process.env.PRINT_FIXTURE_DEBUG
          ? { debugStack: error instanceof Error ? error.stack : String(error) }
          : {}),
      };
    } finally {
      GlobalFonts.removeBatch = remove;
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
      ok: result.ok!,
      overlapCode,
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
  if (!process.send || !process.disconnect) throw new Error('Fixture requires IPC.');
  process.send(results, () => process.disconnect?.());
});
