/** Formula admission is deliberately bounded on the server; clients wait briefly instead of queuing work there. */
export async function requestFormula<T>(url: string, init: RequestInit): Promise<T> {
  const delays = [200, 400, 800, 1200, 1600, 2000];
  for (let attempt = 0; ; attempt++) {
    init.signal?.throwIfAborted();
    const response = await fetch(url, init);
    const result = await response.json();
    init.signal?.throwIfAborted();
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
    if (!response.ok)
      throw new Error(result.error ?? 'The formula could not be loaded. Try again.');
    return result as T;
  }
}
