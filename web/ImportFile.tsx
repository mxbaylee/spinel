import { useRef, useState } from 'react';
import { PORTABLE_LIMIT } from '../src/shared/portable.ts';
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { itemsRequest } from './itemsApi.ts';

export function ImportFile({
  parentId,
  onImported,
}: {
  parentId: string | null;
  onImported: (item: WorkspaceItem) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upload = async (files: FileList | null) => {
    if (running.current || !files?.length) return;
    setError('');
    if (files.length !== 1) {
      setError('Import one Univer file at a time.');
      return;
    }
    const file = files[0];
    if (!/\.(?:json|univer)$/i.test(file.name)) {
      setError(
        'Only Univer JSON files can be imported. PDF, Office and CSV files are not supported.',
      );
      return;
    }
    if (file.size > PORTABLE_LIMIT) {
      setError('Univer files must be at most 20 MiB.');
      return;
    }
    running.current = true;
    setBusy(true);
    try {
      let snapshot: unknown;
      try {
        snapshot = JSON.parse(await file.text());
      } catch {
        throw new Error('Only valid Univer JSON files can be imported.');
      }
      const { item } = await itemsRequest<{ item: WorkspaceItem }>('/import', 'POST', {
        filename: file.name,
        parentId,
        snapshot,
      });
      onImported(item);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import this file.');
    } finally {
      running.current = false;
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <section
      className="import-file"
      aria-label="Import a Univer file"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        void upload(event.dataTransfer.files);
      }}
    >
      <button disabled={busy} onClick={() => input.current?.click()}>
        Import Univer file
      </button>
      <input
        hidden
        ref={input}
        aria-label="Univer file"
        type="file"
        accept=".json,.univer,application/json"
        disabled={busy}
        onChange={(event) => void upload(event.currentTarget.files)}
      />
      <p>{busy ? 'Importing…' : 'Drop a Univer JSON file here, up to 20 MiB.'}</p>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
