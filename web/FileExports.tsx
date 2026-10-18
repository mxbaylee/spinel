import { useState } from 'react';

export function FileExports({
  id,
  name,
  saved,
  print,
}: {
  id: string;
  name: string;
  saved: boolean;
  print: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/items/${id}/export`, { credentials: 'same-origin' });
      if (!response.ok)
        throw new Error((await response.json()).error ?? 'Could not export this file.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `${name}.univer.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export this file.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <details className="file-exports">
      <summary>Export</summary>
      <p>Univer files keep editable content and document images, up to 20 MiB.</p>
      <button disabled={!saved || busy} onClick={() => void download()}>
        Download Univer file
      </button>
      <p>
        For PDF, choose Save as PDF in the print dialog. Univer may limit printed pages depending on
        the license.
      </p>
      <button
        disabled={!saved || busy}
        onClick={() => {
          setError('');
          void print().catch((cause) =>
            setError(cause instanceof Error ? cause.message : 'Could not open printing.'),
          );
        }}
      >
        Print / save PDF
      </button>
      {!saved && <p>Wait until changes are saved before exporting.</p>}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
