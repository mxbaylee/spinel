import { appendFileSync, writeFileSync } from 'node:fs';
import type { CDPSession } from '@playwright/test';

/** Diagnostic transport only: bounded event output avoids the earlier stream export failure. */
export async function startDiagnosticTrace(cdp: CDPSession, path: string) {
  const maximumBytes = 128 * 1024 * 1024;
  let bytes = 0;
  let events = 0;
  let overflow = false;
  let writeError: string | undefined;
  const marks: Array<{ name: string; pid: number; tid: number; ts: number }> = [];
  writeFileSync(path, '');
  const collect = ({ value }: { value: unknown[] }) => {
    if (overflow || writeError) return;
    try {
      const line = JSON.stringify(value) + '\n';
      const size = Buffer.byteLength(line);
      if (bytes + size > maximumBytes) {
        overflow = true;
        return;
      }
      appendFileSync(path, line);
      bytes += size;
      events += value.length;
      for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const event = item as Record<string, unknown>;
        if (event.name !== 'spn071-clock-start' && event.name !== 'spn071-clock-end') continue;
        if (
          typeof event.pid === 'number' &&
          typeof event.tid === 'number' &&
          typeof event.ts === 'number' &&
          Number.isFinite(event.ts)
        )
          marks.push({ name: event.name, pid: event.pid, tid: event.tid, ts: event.ts });
      }
    } catch (error) {
      writeError = String(error);
    }
  };
  cdp.on('Tracing.dataCollected', collect);
  try {
    await cdp.send('Tracing.start', {
      categories: 'devtools.timeline,v8,blink.user_timing,disabled-by-default-v8.gc',
      transferMode: 'ReportEvents',
      options: 'record-until-full',
    });
  } catch (error) {
    cdp.off('Tracing.dataCollected', collect);
    throw error;
  }
  return async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let completeListener: ((value: { dataLossOccurred: boolean }) => void) | undefined;
    try {
      const completed = new Promise<{ dataLossOccurred: boolean }>((resolve, reject) => {
        completeListener = resolve;
        cdp.once('Tracing.tracingComplete', resolve);
        timer = setTimeout(
          () => reject(new Error('Diagnostic trace finalization exceeded 30 seconds')),
          30_000,
        );
      });
      // Start observing completion before end; retain partial output on any failure.
      const [, result] = await Promise.all([cdp.send('Tracing.end'), completed]);
      const [start, end] = marks;
      const clockAligned =
        marks.length === 2 &&
        start?.name === 'spn071-clock-start' &&
        end?.name === 'spn071-clock-end' &&
        start.pid === end.pid &&
        start.tid === end.tid &&
        end.ts > start.ts;
      return {
        bytes,
        events,
        overflow,
        writeError,
        marks,
        clockAligned,
        dataLossOccurred: result.dataLossOccurred,
        complete:
          events > 0 &&
          bytes > 0 &&
          clockAligned &&
          !overflow &&
          !writeError &&
          !result.dataLossOccurred,
      };
    } finally {
      clearTimeout(timer);
      cdp.off('Tracing.dataCollected', collect);
      if (completeListener) cdp.off('Tracing.tracingComplete', completeListener);
    }
  };
}
