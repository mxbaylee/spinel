import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { downloadPdf, preparePdfDownload, readPdfOptions } from './pdfApi.ts';
import type { PdfOptions } from './pdfApi.ts';
import { guestRevokedEvent } from './guestRevocation.ts';
import './fileDialog.css';

/** This component owns the request lifetime, including closing its containing dialog. */
export function PdfExport({
  id,
  name,
  spaceId,
  saved,
}: {
  id: string;
  name: string;
  spaceId?: string;
  saved: boolean;
}) {
  const [options, setOptions] = useState<PdfOptions | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const request = useRef<AbortController | null>(null);
  const savedNow = useRef(saved);
  savedNow.current = saved;
  const identity = useRef({ id, spaceId });
  if (identity.current.id !== id || identity.current.spaceId !== spaceId)
    identity.current = { id, spaceId };

  useEffect(() => {
    const controller = new AbortController();
    const current = identity.current;
    setOptions(null);
    setBusy(false);
    setError('');
    setMessage('');
    if (saved)
      void readPdfOptions(id, controller.signal, spaceId, () => {
        if (current !== identity.current) throw new DOMException('View changed.', 'AbortError');
      })
        .then((value) => {
          if (controller.signal.aborted || current !== identity.current) return;
          setOptions(value);
          setSelected(value.worksheets?.map((sheet) => sheet.id) ?? []);
        })
        .catch((cause) => {
          if (!controller.signal.aborted && current === identity.current)
            setError(cause instanceof Error ? cause.message : 'Could not load PDF options.');
        });
    else {
      request.current?.abort();
      request.current = null;
      setBusy(false);
    }
    return () => controller.abort();
  }, [id, spaceId, saved, attempt]);

  useLayoutEffect(() => {
    const cancel = () => {
      request.current?.abort();
      request.current = null;
    };
    window.addEventListener(guestRevokedEvent, cancel);
    return () => {
      cancel();
      window.removeEventListener(guestRevokedEvent, cancel);
    };
  }, [id, spaceId]);

  async function exportPdf() {
    if (!savedNow.current || !options || request.current) return;
    const current = identity.current;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await preparePdfDownload(
        id,
        name,
        options.kind === 'sheet' ? selected : undefined,
        controller.signal,
        spaceId,
        () => {
          if (current !== identity.current) throw new DOMException('View changed.', 'AbortError');
        },
      );
      if (
        controller.signal.aborted || !savedNow.current ||
        current !== identity.current || request.current !== controller
      ) return;
      downloadPdf(result.blob, result.filename);
      setMessage('PDF download started.');
    } catch (cause) {
      if (!controller.signal.aborted && current === identity.current && request.current === controller)
        setError(cause instanceof Error ? cause.message : 'Could not export this PDF. Try again.');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <section className="pdf-export file-dialog" aria-label="PDF export">
      <p>Download a complete PDF with light pages and no watermark.</p>
      {options?.kind === 'sheet' && (
        <fieldset disabled={busy} className="pdf-worksheets">
          <legend>Worksheets</legend>
          <p>Visible worksheets, in workbook order.</p>
          {options.worksheets?.map((sheet) => (
            <label key={sheet.id}>
              <input
                type="checkbox"
                checked={selected.includes(sheet.id)}
                onChange={(event) =>
                  setSelected((ids) =>
                    event.target.checked ? [...ids, sheet.id] : ids.filter((id) => id !== sheet.id),
                  )
                }
              />
              <span>{sheet.name}</span>
            </label>
          ))}
          {!options.worksheets?.length && <p>This spreadsheet has no visible worksheets.</p>}
        </fieldset>
      )}
      {!saved && <p>Wait until changes are saved before exporting.</p>}
      <div className="pdf-export-status" role="status" aria-live="polite" aria-atomic="true">
        {busy
          ? 'Preparing PDF…'
          : saved && !options && !error
            ? 'Loading PDF options…'
            : message}
      </div>
      {error && <p role="alert">{error}</p>}
      {error && !options ? (
        <button disabled={!saved} onClick={() => setAttempt((value) => value + 1)}>
          Try again
        </button>
      ) : (
        <div className="pdf-export-actions">
          <button
            className="primary"
            disabled={!saved || !options || busy || (options.kind === 'sheet' && !selected.length)}
            onClick={() => void exportPdf()}
          >
            Export as PDF
          </button>
          {busy && (
            <button
              onClick={() => {
                request.current?.abort();
                request.current = null;
                setBusy(false);
                setMessage('Export cancelled.');
              }}
            >
              Cancel export
            </button>
          )}
        </div>
      )}
    </section>
  );
}
