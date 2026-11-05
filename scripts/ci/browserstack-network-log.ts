import { createHash } from 'node:crypto';

type Row = Record<string, unknown>;
const row = (value: unknown): Row | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null;
const duration = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 3_600_000
    ? value
    : null;

export const retainedNetworkEntries = 128;

/** Public HAR metadata only: never retain raw URLs, headers, cookies or content. */
export function analyzeNetworkLog(text: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('invalid-network-log');
  }
  const log = row(row(parsed)?.log);
  if (log?.version !== '1.2' || !Array.isArray(log.entries)) throw new Error('invalid-network-log');
  const entries: {
    index: number;
    fixtureHost: boolean;
    pathSha256: string;
    kind: 'script' | 'stylesheet' | 'worker' | 'document' | 'other';
    status: number;
    mime: 'javascript' | 'css' | 'html' | 'json' | 'image' | 'font' | 'other' | 'missing';
    timeMs: number | null;
    waitMs: number | null;
    receiveMs: number | null;
    bodyBytes: number | null;
  }[] = [];
  let malformedEntries = 0;
  let omittedEntries = 0;
  for (const [index, raw] of log.entries.entries()) {
    const entry = row(raw),
      request = row(entry?.request),
      response = row(entry?.response);
    if (
      !entry ||
      !request ||
      !response ||
      typeof request.url !== 'string' ||
      request.url.length > 8192 ||
      !Number.isInteger(response.status) ||
      (response.status as number) < 0 ||
      (response.status as number) > 599
    ) {
      malformedEntries++;
      continue;
    }
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      malformedEntries++;
      continue;
    }
    if (!['https:', 'http:'].includes(url.protocol)) {
      malformedEntries++;
      continue;
    }
    if (entries.length === retainedNetworkEntries) {
      omittedEntries++;
      continue;
    }
    const content = row(response.content),
      timing = row(entry.timings);
    const media =
      typeof content?.mimeType === 'string'
        ? content.mimeType.split(';', 1)[0].trim().toLowerCase()
        : '';
    const path = url.pathname;
    entries.push({
      index,
      fixtureHost: url.hostname === 'bs-local.com',
      pathSha256: createHash('sha256').update(path).digest('hex'),
      kind:
        path === '/service-worker.js'
          ? 'worker'
          : path.endsWith('.js')
            ? 'script'
            : path.endsWith('.css')
              ? 'stylesheet'
              : path === '/' || path === '/sign-in'
                ? 'document'
                : 'other',
      status: response.status as number,
      mime: !media
        ? 'missing'
        : ['application/javascript', 'text/javascript', 'application/x-javascript'].includes(media)
          ? 'javascript'
          : media === 'text/css'
            ? 'css'
            : media === 'text/html'
              ? 'html'
              : media === 'application/json'
                ? 'json'
                : media.startsWith('image/')
                  ? 'image'
                  : media.startsWith('font/')
                    ? 'font'
                    : 'other',
      timeMs: duration(entry.time),
      waitMs: duration(timing?.wait),
      receiveMs: duration(timing?.receive),
      bodyBytes:
        typeof response.bodySize === 'number' &&
        Number.isSafeInteger(response.bodySize) &&
        response.bodySize >= 0
          ? response.bodySize
          : null,
    });
  }
  return {
    format: 'har-1.2' as const,
    totalEntries: log.entries.length,
    complete: !malformedEntries && !omittedEntries,
    malformedEntries,
    omittedEntries,
    entries,
  };
}
