import { useRef, useState } from 'react';
import { PORTABLE_LIMIT } from '../../shared/portable.ts';
import { Button, Modal } from './Controls.tsx';
import './importReview.css';

export type ImportReviewState =
  | 'ready'
  | 'limits-open'
  | 'unsupported-file'
  | 'not-json'
  | 'too-many-files'
  | 'importing'
  | 'import-failed'
  | 'completed';

const errors: Partial<Record<ImportReviewState, string>> = {
  'unsupported-file':
    'Only Univer JSON files can be imported. PDF, Office and CSV files are not supported.',
  'not-json': 'Only valid Univer JSON files can be imported.',
  'too-many-files': 'Import one Univer file at a time.',
  'import-failed': 'This file is not a Spinel-compatible Univer file.',
};

/** Review surface for the existing import contract. No server calls or credentials. */
export function ImportReview({
  state = 'ready',
  destination = 'My files',
  onBusyChange,
}: {
  state?: ImportReviewState;
  destination?: string;
  onBusyChange?: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const [busy, setBusy] = useState(state === 'importing');
  const [error, setError] = useState(errors[state] ?? '');
  const [notice, setNotice] = useState(
    state === 'completed' ? `budget.univer.json was imported to ${destination}.` : '',
  );
  const [filename, setFilename] = useState(
    state === 'unsupported-file'
      ? 'budget.pdf'
      : state === 'ready' || state === 'limits-open'
        ? ''
        : state === 'too-many-files'
          ? '2 files selected'
          : 'budget.univer.json',
  );
  const upload = async (files: FileList | null) => {
    if (busy || running.current || !files?.length) return;
    setNotice('');
    setError('');
    setFilename(files.length > 1 ? `${files.length} files selected` : files[0].name);
    if (files.length !== 1) {
      setError(errors['too-many-files']!);
      return;
    }
    const file = files[0];
    if (!/\.(?:json|univer)$/i.test(file.name)) {
      setError(errors['unsupported-file']!);
      return;
    }
    if (file.size > PORTABLE_LIMIT) {
      setError('Univer files must be at most 20 MiB.');
      return;
    }
    running.current = true;
    setBusy(true);
    onBusyChange?.(true);
    try {
      try {
        JSON.parse(await file.text());
      } catch {
        throw new Error(errors['not-json']);
      }
      setNotice('File selected. Import is not connected in this preview.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not import this file.');
    } finally {
      running.current = false;
      setBusy(false);
      onBusyChange?.(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <section className="rd-import-review" aria-label="Import a Univer file" aria-busy={busy}>
      <p className="rd-import-destination">
        Destination <strong>{destination}</strong>
      </p>
      <div
        className="rd-import-drop"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return;
          event.preventDefault();
          void upload(event.dataTransfer.files);
        }}
      >
        <Button primary disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Importing…' : error ? 'Choose another file' : 'Choose Univer file'}
        </Button>
        <input
          hidden
          ref={input}
          aria-label="Univer file"
          type="file"
          accept=".json,.univer,application/json"
          disabled={busy}
          onChange={(event) => void upload(event.currentTarget.files)}
        />
        <p className="sp-muted">Or drop one Univer JSON file here, up to 20 MiB.</p>
        {filename && <p className="rd-import-filename">{filename}</p>}
      </div>
      {busy && <p role="status">Importing {filename}. Keep this dialog open.</p>}
      {error && (
        <p className="rd-import-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <details className="rd-import-limits" open={state === 'limits-open'}>
        <summary>Import limits</summary>
        <p>Univer JSON files only. PDF, Office and CSV files are not supported.</p>
        <p>
          Up to 100 sheets, each with 100,000 rows and 1,024 columns; totals of 250,000 rows, 4,096
          columns and 100,000 populated cells.
        </p>
        <p>
          Documents can contain up to one million characters. Document images must be embedded PNG,
          JPEG or WebP, up to 5 MiB each. Spreadsheet images are not supported yet.
        </p>
      </details>
    </section>
  );
}

export function ImportDialog({
  open,
  onOpenChange,
  destination,
  state,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destination?: string;
  state?: ImportReviewState;
}) {
  const [busy, setBusy] = useState(state === 'importing');
  return (
    <Modal
      icon="upload"
      title="Import a Univer file"
      description="Add a Sheet or Doc from a Univer JSON file."
      open={open}
      dismissDisabled={busy}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <ImportReview state={state} destination={destination} onBusyChange={setBusy} />
      <div className="sp-actions">
        <Button disabled={busy} onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
