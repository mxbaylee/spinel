/** Close every owned upgrade resource, retaining the first failure ahead of cleanup errors. */
export async function finishUpgrade(
  actions: (() => unknown | Promise<unknown>)[],
  firstFailure?: unknown,
  observation?: { finish(firstFailure?: unknown): Promise<void> },
) {
  const failures: unknown[] = firstFailure === undefined ? [] : [firstFailure];
  // The observer already bounds collection/cleanup and then persistence. Await
  // that owned sequence before browser teardown; a competing five-second timer
  // would abandon its receipt while it is still legitimately being written.
  if (observation)
    try {
      await observation.finish(firstFailure);
    } catch (error) {
      if (firstFailure === undefined || error !== firstFailure) {
        if (
          firstFailure !== undefined &&
          error instanceof AggregateError &&
          error.errors[0] === firstFailure
        )
          failures.push(...error.errors.slice(1));
        else failures.push(error);
      }
    }
  for (const action of actions) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(action),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Owned upgrade cleanup exceeded five seconds.')),
            5000,
          );
        }),
      ]);
    } catch (error) {
      failures.push(error);
    } finally {
      clearTimeout(timer);
    }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length)
    throw new AggregateError(failures, 'Offline upgrade failed; original failure is first.');
}
