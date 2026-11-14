// Shared by the capability control plane and its durable GitHub reservation.
// Remote bodies, headers and error strings never become diagnostic messages.
export class ControlError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

// A backward wall-clock jump cannot renew a control-plane budget.
export function boundedClock(read = Date.now, steady = () => performance.now()) {
  let previous = read();
  let previousSteady = steady();
  return () => {
    const currentSteady = steady();
    if (!Number.isFinite(currentSteady) || currentSteady < previousSteady) throw new ControlError('control-bounds-invalid');
    const value = Math.max(read(), previous + currentSteady - previousSteady);
    if (!Number.isSafeInteger(Math.trunc(value))) throw new ControlError('control-bounds-invalid');
    previousSteady = currentSteady;
    previous = value;
    return value;
  };
}

export async function boundedJson(options: {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers: Record<string, string>;
  body?: unknown;
  signal: AbortSignal;
  deadline: number;
  timeoutMs: number;
  maximumBytes: number;
  now?: () => number;
  fetcher?: typeof fetch;
}): Promise<unknown> {
  if (
    !Number.isSafeInteger(options.maximumBytes) ||
    options.maximumBytes < 1 ||
    options.maximumBytes > 2 * 1024 * 1024 ||
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1 ||
    options.timeoutMs > 45000 ||
    !Number.isSafeInteger(options.deadline)
  )
    throw new ControlError('control-bounds-invalid');
  const now = boundedClock(options.now);
  const remaining = Math.min(options.timeoutMs, options.deadline - now());
  if (options.signal.aborted || remaining <= 0) throw new ControlError('control-deadline');
  const requestDeadline = Math.min(options.deadline, now() + remaining);
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(Math.ceil(remaining))]);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let abort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    abort = () => reject(new ControlError('control-deadline'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  const active = () => {
    if (signal.aborted || now() >= requestDeadline) throw new ControlError('control-deadline');
  };
  try {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    if (body !== undefined && Buffer.byteLength(body) > options.maximumBytes)
      throw new ControlError('control-request-too-large');
    const fetchPromise = (options.fetcher ?? fetch)(options.url, {
      method: options.method,
      headers: options.headers,
      body,
      signal,
      redirect: 'error',
    }).then((result) => {
      // A transport that resolves after cancellation must not retain its body.
      if (signal.aborted) void result.body?.cancel().catch(() => {});
      return result;
    });
    response = await Promise.race([fetchPromise, stopped]);
    active();
    if (!response.ok) throw new ControlError(`control-http-${response.status}`);
    const declared = response.headers.get('content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > options.maximumBytes))
      throw new ControlError('control-response-too-large');
    if (!response.body) throw new ControlError('control-response-invalid');
    reader = response.body.getReader();
    const buffer = new Uint8Array(options.maximumBytes);
    let length = 0;
    for (let chunks = 0; ; chunks++) {
      active();
      if (chunks >= 4096) throw new ControlError('control-response-too-large');
      const part = await Promise.race([reader.read(), stopped]);
      active();
      if (part.done) break;
      if (part.value.byteLength > buffer.byteLength - length)
        throw new ControlError('control-response-too-large');
      buffer.set(part.value, length);
      length += part.value.byteLength;
    }
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)),
    );
    active();
    return value;
  } catch (error) {
    if (error instanceof ControlError) throw error;
    throw new ControlError(signal.aborted ? 'control-deadline' : 'control-request-failed');
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    // Cleanup cannot extend the control-plane deadline on a stalled transport.
    if (reader) void reader.cancel().catch(() => {});
    else if (response?.body) void response.body.cancel().catch(() => {});
  }
}
