/** Test child process only: native font registries may be shared by JS workers. */
import { GlobalFonts } from '@napi-rs/canvas';
import { renderSheetPdfCandidate } from './native.ts';
import type { NativeSheetInput } from './native.ts';
import type { SheetPrintOptions } from './contract.ts';

export interface NativeJob {
  input: NativeSheetInput;
  options?: Omit<SheetPrintOptions, 'signal'>;
  abort?: boolean;
}

process.once('message', async (message) => {
  const names = ['OffscreenCanvas', 'Image', 'Path2D'];
  const before = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const results = [];
  for (const job of message as NativeJob[]) {
    let result;
    try {
      result = {
        ok: true,
        ...(await renderSheetPdfCandidate(job.input, {
          ...job.options,
          ...(job.abort ? { signal: AbortSignal.abort() } : {}),
        })),
      };
    } catch (error) {
      result = {
        ok: false,
        code: (error as { code?: string }).code,
        message: error instanceof Error ? error.message : 'Unknown failure',
      };
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
    results.push({ ...result, restored, remainingFonts: GlobalFonts.families.length });
  }
  process.send!(results);
  process.disconnect();
});
