/** Probe without a version upgrade or an empty database left behind. */
export function openExistingDatabase(name: string, timeoutMs = 3000): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(name);
    let missing = false;
    let settled = false;
    const finish = (value: IDBDatabase | null, error?: unknown) => {
      if (settled) {
        value?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(
      () => finish(null, new Error('Browser storage did not respond. Try again.')),
      timeoutMs,
    );
    opening.onupgradeneeded = (event) => {
      // open(name) also creates when absent. Abort even after our caller times out.
      if (event.oldVersion === 0) {
        missing = true;
        opening.transaction?.abort();
      }
    };
    opening.onerror = () => finish(null, missing ? undefined : opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      database.onversionchange = () => database.close();
      finish(database);
    };
  });
}
