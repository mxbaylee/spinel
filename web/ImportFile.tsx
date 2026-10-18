import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { PORTABLE_LIMIT } from '../src/shared/portable.ts';
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { itemsRequest } from './itemsApi.ts';

export function ImportFile({
  parentId,
  dropTarget,
  onImported,
}: {
  parentId: string | null;
  dropTarget: RefObject<HTMLElement>;
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
  useEffect(() => {
    const target = dropTarget.current;
    if (!target) return;
    const drag = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      void upload(event.dataTransfer.files);
    };
    target.addEventListener('dragover', drag);
    target.addEventListener('drop', drop);
    return () => {
      target.removeEventListener('dragover', drag);
      target.removeEventListener('drop', drop);
    };
  });
  return (
    <section className="import-file" aria-label="Import a Univer file">
      <button disabled={busy} onClick={() => input.current?.click()}>
        Import Univer file
      </button>
      <input
        hidden
        style={{ display: 'none' }}
        ref={input}
        aria-label="Univer file"
        type="file"
        accept=".json,.univer,application/json"
        disabled={busy}
        onChange={(event) => void upload(event.currentTarget.files)}
      />
      <p>
        {busy ? 'Importing…' : 'Drop a Univer JSON file anywhere in this folder, up to 20 MiB.'}
      </p>
      <details>
        <summary>Import limits</summary>
        <p>
          Up to 100 sheets, each with 100,000 rows and 1,024 columns; totals of 250,000 rows, 4,096
          columns and 100,000 populated cells. Documents can contain up to one million characters.
          Document images must be embedded PNG, JPEG or WebP, up to 5 MiB each. Spreadsheet images
          are not supported yet.
        </p>
      </details>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
