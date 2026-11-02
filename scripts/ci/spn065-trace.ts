import { appendFile, writeFile } from 'node:fs/promises';
import type { CDPSession } from '@playwright/test';

export async function bounded<T>(operation: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out.`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function retainDiagnosticTrace(cdp: CDPSession, path: string) {
  let stream: string | undefined;
  let listener: ((event: { stream?: string }) => void) | undefined;
  let stopped = false;
  const collect = async () => {
    const complete = new Promise<{ stream?: string }>((resolve) => {
      listener = resolve;
      cdp.once('Tracing.tracingComplete', listener);
    });
    await cdp.send('Tracing.end');
    stream = (await complete).stream;
    if (!stream) throw new Error('Missing diagnostic trace stream.');
    await writeFile(path, '');
    let bytes = 0;
    for (;;) {
      if (stopped) throw new Error('Trace collection cancelled.');
      const chunk = await cdp.send('IO.read', { handle: stream, size: 1048576 });
      if (stopped) throw new Error('Trace collection cancelled.');
      const data = chunk.base64Encoded
        ? Buffer.from(chunk.data, 'base64')
        : Buffer.from(chunk.data);
      bytes += data.length;
      if (bytes > 128 * 1024 * 1024) throw new Error('Diagnostic trace exceeded 128 MiB bound.');
      await appendFile(path, data);
      if (chunk.eof) return bytes;
    }
  };
  try {
    return await bounded(collect(), 10_000, 'Trace extraction');
  } finally {
    stopped = true;
    if (listener) cdp.off('Tracing.tracingComplete', listener);
    if (stream)
      await bounded(cdp.send('IO.close', { handle: stream }), 2_000, 'Trace close').catch(() => {});
    // The caller always detaches the session, rejecting any outstanding CDP read.
  }
}
