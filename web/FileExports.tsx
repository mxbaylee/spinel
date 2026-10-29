import { maintenanceFetch as fetch } from './maintenanceFetch.ts';
import { useState } from 'react';
import { documentPath } from './documentAccess.ts';
import { PdfExport } from './PdfExport.tsx';
import './fileDialog.css';

export function FileExports({
  id,
  name,
  saved,
  spaceId,
  embedded = false,
}: {
  id: string;
  name: string;
  saved: boolean;
  spaceId?: string;
  embedded?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${documentPath(id, spaceId)}/export`, {
        credentials: 'same-origin',
      });
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
  const content = (
    <>
      <PdfExport id={id} name={name} spaceId={spaceId} saved={saved} />
      <section className="file-dialog" aria-label="Editable file export">
        <h3>Editable file</h3>
        <p>Univer files keep editable content and document images, up to 20 MiB.</p>
        <button disabled={!saved || busy} onClick={() => void download()}>
          Download Univer file
        </button>
      </section>
      {error && <p role="alert">{error}</p>}
    </>
  );
  return embedded ? (
    <div className="file-exports file-dialog">{content}</div>
  ) : (
    <details className="file-exports">
      <summary>Export</summary>
      {content}
    </details>
  );
}
