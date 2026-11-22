/** Production feedback below the Doc toolbar; stories exercise the same text and alert. */
export function DocEditorHelp({
  uploadError = '',
  formulaError = '',
  phoneLayoutChanged = false,
  phoneReadOnly = false,
  editable = false,
  mobile = false,
}: {
  uploadError?: string;
  formulaError?: string;
  phoneLayoutChanged?: boolean;
  phoneReadOnly?: boolean;
  editable?: boolean;
  mobile?: boolean;
}) {
  return (
    <p className="editor-help" role={uploadError || formulaError ? 'alert' : undefined}>
      {uploadError ||
        formulaError ||
        (phoneLayoutChanged
          ? 'This Doc’s page layout changed. Reopen it to continue.'
          : phoneReadOnly
            ? 'Edit on a larger screen. This Doc keeps its page layout.'
            : editable
              ? mobile
                ? 'Tap Edit, then tap the text to write.'
                : 'Click the page to write. Type / for commands.'
              : '')}
    </p>
  );
}
