import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { ARCHIVE_LIMIT } from '../src/shared/archive.ts';
import type { ArchiveImportResult } from '../src/shared/archive.ts';
import { PORTABLE_LIMIT } from '../src/shared/portable.ts';
import type { WorkspaceItem } from '../src/shared/workspace.ts';
import { itemsRequest } from './itemsApi.ts';
import { Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { ArchiveRequestError, importWorkspaceArchive } from './workspaceArchiveApi.ts';
import './fileDialog.css';

export function ImportFile({
  parentId,
  dropTarget,
  enabled,
  onImported,
  onArchiveImported,
  dialogOpen,
  onDialogOpenChange,
}: {
  parentId: string | null;
  dropTarget: RefObject<HTMLElement | null>;
  enabled: boolean;
  onImported: (item: WorkspaceItem) => void;
  onArchiveImported?: (result: ArchiveImportResult) => void;
  dialogOpen?: boolean;
  onDialogOpenChange?: (open: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const mounted = useRef(false);
  const operation = useRef(0);
  const archiveRequest = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<'native' | 'archive' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filename, setFilename] = useState('');
  const [result, setResult] = useState<ArchiveImportResult | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current++;
      archiveRequest.current?.abort();
    };
  }, []);
  const upload = async (files: FileList | null) => {
    if (running.current || !files?.length) return;
    onDialogOpenChange?.(true);
    setError('');
    setNotice('');
    setResult(null);
    if (files.length !== 1) {
      setError('Import one Univer file or Spinel ZIP archive at a time.');
      return;
    }
    const file = files[0];
    const archive = /\.zip$/i.test(file.name);
    setFilename(file.name);
    if (archive && parentId !== null) {
      setError('Open My files to import a Spinel ZIP archive.');
      return;
    }
    if (!archive && !/\.(?:json|univer)$/i.test(file.name)) {
      setError(
        'Choose a Univer JSON file or Spinel ZIP archive. PDF, Office and CSV files are not supported.',
      );
      return;
    }
    if (file.size > (archive ? ARCHIVE_LIMIT : PORTABLE_LIMIT)) {
      setError(
        archive ? 'Spinel archives must be at most 8 GiB.' : 'Univer files must be at most 20 MiB.',
      );
      return;
    }
    const identity = ++operation.current;
    const current = () => mounted.current && identity === operation.current;
    running.current = true;
    setBusy(archive ? 'archive' : 'native');
    try {
      if (archive) {
        const controller = new AbortController();
        archiveRequest.current = controller;
        const { result: imported } = await importWorkspaceArchive(file, controller.signal);
        if (!current()) return;
        setResult(imported);
        onArchiveImported?.(imported);
        return;
      }
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
      if (!current()) return;
      onImported(item);
    } catch (cause) {
      if (!current()) return;
      setError(
        archive && !(cause instanceof ArchiveRequestError)
          ? 'Could not confirm the import. Refresh your files before trying again.'
          : cause instanceof Error
            ? cause.message
            : 'Could not import this file.',
      );
    } finally {
      if (current()) {
        running.current = false;
        archiveRequest.current = null;
        setBusy(null);
        if (input.current) input.current.value = '';
      }
    }
  };
  const cancelArchive = () => {
    operation.current++;
    archiveRequest.current?.abort();
    archiveRequest.current = null;
    running.current = false;
    setBusy(null);
    setNotice(
      'Import stopped. Refresh your files to check whether it finished before trying again.',
    );
    if (input.current) input.current.value = '';
  };
  useEffect(() => {
    const target = dropTarget.current;
    if (!target || !enabled) return;
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
  const content = (
    <section
      className={`import-file${dialogOpen === undefined ? '' : ' file-dialog'}`}
      aria-label="Import a file"
      aria-busy={Boolean(busy)}
    >
      <button disabled={Boolean(busy)} onClick={() => input.current?.click()}>
        {error || result || notice ? 'Choose another file' : 'Choose file'}
      </button>
      <input
        hidden
        style={{ display: 'none' }}
        ref={input}
        aria-label="Univer file or archive"
        type="file"
        accept={
          parentId === null
            ? '.json,.univer,.zip,application/json,application/zip'
            : '.json,.univer,application/json'
        }
        disabled={Boolean(busy)}
        onChange={(event) => void upload(event.currentTarget.files)}
      />
      {busy ? (
        <p role="status">
          {busy === 'archive'
            ? `Importing ${filename}. Your files will appear together when the archive is ready.`
            : 'Importing…'}
        </p>
      ) : (
        <p>
          {parentId === null
            ? 'Drop a Univer JSON file or Spinel ZIP archive anywhere in My files.'
            : 'Drop a Univer JSON file anywhere in this folder, up to 20 MiB.'}
        </p>
      )}
      {result && (
        <p role="status">
          {result.items === 0
            ? 'This archive was empty. No items were added.'
            : `Imported ${result.files} ${result.files === 1 ? 'file' : 'files'}, ${result.folders} ${result.folders === 1 ? 'folder' : 'folders'} and ${result.spaces} ${result.spaces === 1 ? 'Space' : 'Spaces'} into My files.`}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <details>
        <summary>Import limits</summary>
        <p>
          Univer files can be up to 20 MiB. Spinel ZIP archives can be up to 8 GiB and import into
          My files as new items, preserving folders and whole Spaces. Sharing and history are not
          included.
        </p>
        <p>
          Up to 100 sheets, each with 100,000 rows and 1,024 columns; totals of 250,000 rows, 4,096
          columns and 100,000 populated cells. Documents can contain up to one million characters.
          Sheet and Doc images must be embedded PNG, JPEG or WebP, up to 5 MiB each.
        </p>
      </details>
      {error && <p role="alert">{error}</p>}
      {busy === 'archive' && (
        <div className="sp-actions">
          <Button onClick={cancelArchive}>Cancel import</Button>
        </div>
      )}
      {!busy && (result || notice) && onDialogOpenChange && (
        <div className="sp-actions">
          <Button onClick={() => onDialogOpenChange(false)}>Done</Button>
        </div>
      )}
    </section>
  );
  return dialogOpen === undefined ? (
    content
  ) : (
    <Modal
      title="Import file"
      icon="upload"
      open={dialogOpen}
      onOpenChange={onDialogOpenChange}
      dismissDisabled={Boolean(busy)}
    >
      {content}
    </Modal>
  );
}
