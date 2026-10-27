/** Browser storage failures may have a name but no message, including across worker replies. */
export function offlineErrorMessage(error: unknown, fallback: string): string {
  const details =
    error && typeof error === 'object'
      ? (error as { name?: unknown; message?: unknown })
      : undefined;
  if (details?.name === 'QuotaExceededError')
    return 'This device is out of space for offline documents.';
  const message = typeof error === 'string' ? error : details?.message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}
