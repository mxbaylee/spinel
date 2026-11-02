/** Attempt every owned cleanup, retaining secondary failures without masking the test error. */
export async function closeSheetImageFixture(
  writeDiagnostics: () => Promise<unknown>,
  contexts: { close(): Promise<void> }[],
  closeDatabase: () => void,
) {
  const failures: unknown[] = [];
  for (const close of [
    writeDiagnostics,
    ...contexts.map((context) => () => context.close()),
    closeDatabase,
  ]) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}
