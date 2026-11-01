/** Stable editor help slot shared by the production Sheet and its stories. */
export function SheetImageStatus({ error = '' }: { error?: string }) {
  return (
    <p className="editor-help" role={error ? 'alert' : undefined} title={error || undefined}>
      {error || '\u00a0'}
    </p>
  );
}
