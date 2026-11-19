/** Content-free failure evidence for the fixed supervised-restore fixture. */
const codes = [
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'ENOMEM',
  'ENOSPC',
  'EMFILE',
  'EACCES',
  'EPERM',
  'ENOENT',
  'ERR_WORKER_OUT_OF_MEMORY',
  'ERR_HTTP_HEADERS_SENT',
  'ERR_STREAM_PREMATURE_CLOSE',
  'SQLITE_BUSY',
  'SQLITE_IOERR',
] as const;

export function maintenanceErrorCode(error: unknown) {
  if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
    return error.name;
  const message = error instanceof Error ? error.message : String(error);
  return codes.find((code) => new RegExp(`\\b${code}\\b`).test(message)) ?? 'unclassified';
}

export async function readMaintenanceEvidence<T>(read: () => T | Promise<T>) {
  try {
    return { ok: true as const, value: await read() };
  } catch (error) {
    return { ok: false as const, code: maintenanceErrorCode(error) };
  }
}

export function maintenanceLogEvidence(tail: Buffer, bytes: number) {
  const text = tail.subarray(-16_384).toString('utf8');
  return {
    bytes,
    retainedBytes: Math.min(tail.length, 16_384),
    truncated: bytes > 16_384,
    codes: codes.filter((code) => new RegExp(`\\b${code}\\b`).test(text)),
    headlines: [
      'JavaScript heap out of memory',
      'Allocation failed',
      'Fatal process out of memory',
      'Spinel recovery control is available',
    ].filter((headline) => text.includes(headline)),
    // No original line, request header, path, command or document text is emitted.
    rawOutputRetained: false,
  };
}

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const uuid = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
    ? value
    : null;

export function maintenanceJournalEvidence(value: unknown) {
  const state = object(value);
  const child = object(state.child);
  const phases = [
    'running',
    'draining',
    'paused',
    'stopping',
    'stopped',
    'starting',
    'recovery-required',
  ];
  return {
    phase: phases.includes(String(state.phase)) ? (state.phase as string) : null,
    epoch: uuid(state.epoch),
    generationId: uuid(state.generationId),
    updatedAt: Number.isSafeInteger(state.updatedAt) ? (state.updatedAt as number) : null,
    restorePending: state.restoreJob !== null && typeof state.restoreJob === 'object',
    child:
      state.child === null
        ? null
        : {
            pid:
              Number.isSafeInteger(child.pid) && Number(child.pid) > 0
                ? (child.pid as number)
                : null,
            start:
              typeof child.start === 'string' && /^\d{1,24}$/.test(child.start)
                ? child.start
                : null,
            boot: uuid(child.boot),
          },
    // This is the journal's last selected identity, not an independent liveness check.
    childLiveness: 'not-inferred-from-journal',
  };
}

export function maintenanceMemoryEvents(text: string) {
  const allowed = ['low', 'high', 'max', 'oom', 'oom_kill', 'oom_group_kill'];
  return Object.fromEntries(
    text
      .slice(0, 4096)
      .split('\n')
      .flatMap((line) => {
        const match = /^(\w+) (\d{1,24})$/.exec(line);
        return match && allowed.includes(match[1]) ? [[match[1], match[2]]] : [];
      }),
  );
}

export async function maintenanceStatusEvidence(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Maintenance status has no body.');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 16_384) throw new Error('Maintenance status exceeds its evidence bound.');
      chunks.push(value);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return { status: response.status, phase: maintenanceJournalEvidence(body).phase };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
