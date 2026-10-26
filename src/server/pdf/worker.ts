import { renderSheetPdf, renderDocPdf, PrintError } from '@spinel/print';
import { pdfFonts, PDF_DEFAULT_FAMILY, PDF_FALLBACK_FAMILIES } from './fonts.ts';
import { PDF_LIMITS, PdfError } from './limits.ts';
import type { PdfJob, PdfWorkerReply } from './runner.ts';

/** Exactly one prepared job; no credentials, storage API, network fetch or public output. */
process.once('message', async (job: PdfJob) => {
  const sendMessage = process.send?.bind(process);
  const send = (message: PdfWorkerReply) =>
    new Promise<void>((resolve, reject) => {
      if (!sendMessage) return reject(new Error('No parent process.'));
      sendMessage(message, (error) => (error ? reject(error) : resolve()));
    });
  try {
    const fonts = await pdfFonts(job.input.snapshot);
    const input = {
      ...job.input,
      fonts,
      defaultFamily: PDF_DEFAULT_FAMILY,
      fallbackFamilies: PDF_FALLBACK_FAMILIES,
    };
    const result =
      job.kind === 'sheet'
        ? await renderSheetPdf(
            {
              ...input,
              snapshot: await (
                await import('./sheet-formulas.ts')
              ).prepareSheetFormulas(job.input.snapshot),
            } as Parameters<typeof renderSheetPdf>[0],
            {
              worksheetIds: job.worksheetIds,
              limits: PDF_LIMITS,
            },
          )
        : await renderDocPdf(input as Parameters<typeof renderDocPdf>[0], { limits: PDF_LIMITS });
    // Small, sequential IPC messages bound parent deserialization and retain
    // atomic publication even if the child dies during the final transfer.
    for (let offset = 0; offset < result.bytes.byteLength; offset += 64 * 1024)
      await send({
        type: 'chunk',
        // Own a small backing buffer too: serializing a typed-array view must
        // never copy the complete PDF's backing store for every chunk.
        bytes: new Uint8Array(result.bytes.subarray(offset, offset + 64 * 1024)),
      });
    await send({
      type: 'complete',
      byteLength: result.bytes.byteLength,
      pages: result.pages,
      mediaBox: result.mediaBox,
      durationMs: result.durationMs,
      peakRssBytes: process.resourceUsage().maxRSS * 1024,
    });
    process.disconnect?.();
    process.exit(0);
  } catch (error) {
    const code = error instanceof PrintError || error instanceof PdfError ? error.code : 'failed';
    try {
      await send({
        type: 'failure',
        code: code === 'limit' || code === 'cancelled' || code === 'unsupported' ? code : 'failed',
      });
    } finally {
      process.disconnect?.();
      process.exit(1);
    }
  }
});
