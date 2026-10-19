import { PREPARE_SHELL } from '../../src/shared/offlineShell.ts';
import type { PrepareShellReply } from '../../src/shared/offlineShell.ts';

function within<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Asks the service worker to keep the public app shell on this device. */
export async function prepareShell() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext)
    throw new Error('This browser cannot keep Spinel offline.');
  const registration = await within(
    navigator.serviceWorker.ready,
    10_000,
    'This browser cannot keep Spinel offline.',
  );
  const worker = registration.active;
  if (!worker) throw new Error('This browser cannot keep Spinel offline.');
  const channel = new MessageChannel();
  const reply = new Promise<PrepareShellReply>((resolve) => {
    channel.port1.onmessage = (event) => resolve(event.data as PrepareShellReply);
  });
  worker.postMessage({ type: PREPARE_SHELL }, [channel.port2]);
  try {
    // The shell is about 21 MB; allow a slow phone connection.
    const result = await within(reply, 180_000, 'Keeping Spinel on this device took too long.');
    if (!result.ok) throw new Error(result.error);
  } finally {
    channel.port1.close();
  }
}
