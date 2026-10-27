import { FormulaSaveError } from '@spinel/doc-formulas';

/** Retry only read-only busy/overflow responses, never an expired admission wait. */
export async function requestFormula<T>(
  url: string,
  init: RequestInit,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
  verifyCurrent: () => void = () => {},
): Promise<T> {
  const delays = [200, 400, 800, 1200, 1600, 2000];
  for (let attempt = 0; ; attempt++) {
    init.signal?.throwIfAborted();
    verifyCurrent();
    let response: Response;
    let result;
    try {
      response = await request(url, init);
      result = await response.json();
      verifyCurrent();
    } catch (error) {
      init.signal?.throwIfAborted();
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new FormulaSaveError('unavailable');
    }
    init.signal?.throwIfAborted();
    verifyCurrent();
    const busy = response.status === 429 || (result?.ok === false && result.reason === 'busy');
    if (busy && attempt < delays.length) {
      await new Promise<void>((resolve, reject) => {
        const signal = init.signal;
        const stop = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', stop);
          reject(signal?.reason ?? new DOMException('Request cancelled', 'AbortError'));
        };
        const timer = setTimeout(
          () => {
            signal?.removeEventListener('abort', stop);
            resolve();
          },
          delays[attempt]! + Math.floor(Math.random() * 100),
        );
        signal?.addEventListener('abort', stop, { once: true });
        if (signal?.aborted) stop();
      });
      continue;
    }
    if (response.status === 429) throw new FormulaSaveError('busy');
    if (response.status === 503) throw new FormulaSaveError('unavailable');
    if (!response.ok)
      throw new Error(result.error ?? 'The formula could not be loaded. Try again.');
    return result as T;
  }
}
