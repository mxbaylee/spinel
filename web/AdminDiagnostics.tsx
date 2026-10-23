import { useEffect, useRef, useState } from 'react';
import type { DiagnosticsStatus } from '../src/shared/diagnostics.ts';
import { ActionMenu, Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { AdminRequestError, adminResponse, operatorDenied } from './adminRequest.ts';
import { healthBytes } from './ServerHealth.tsx';
import './diagnostics.css';

export function AdminDiagnostics({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const [status, setStatus] = useState<DiagnosticsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'download' | 'truncate' | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [denied, setDenied] = useState(false);
  const mounted = useRef(false), request = useRef(0), operation = useRef(0);
  const read = useRef<AbortController | null>(null), action = useRef<AbortController | null>(null);
  const pending = useRef(false);
  const menu = useRef<HTMLButtonElement>(null);
  const objectUrls = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    mounted.current = true; void refresh();
    return () => {
      mounted.current = false; request.current++; operation.current++;
      read.current?.abort(); action.current?.abort();
      for (const [url, timer] of objectUrls.current) { clearTimeout(timer); URL.revokeObjectURL(url); }
      objectUrls.current.clear();
    };
  }, []);
  useEffect(() => { onBusyChange?.(busy !== null); return () => onBusyChange?.(false); }, [busy, onBusyChange]);
  async function refresh() {
    read.current?.abort();
    const controller = new AbortController(); read.current = controller;
    const identity = ++request.current;
    const current = () => {
      if (!mounted.current || identity !== request.current || controller.signal.aborted) throw new Error('Obsolete diagnostics request');
    };
    setLoading(true); setStatus(null);
    try {
      const response = await adminResponse('diagnostics', AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]), current);
      const result = await response.json() as DiagnosticsStatus;
      current(); setStatus(result); setDenied(false);
      return true;
    } catch (cause) {
      if (mounted.current && identity === request.current && !controller.signal.aborted) {
        setDenied(operatorDenied(cause));
        setError(operatorDenied(cause) ? 'Operator access is unavailable. Sign in again with your Operator account.' : 'Diagnostics status is unavailable. Refresh to try again.');
      }
      return false;
    } finally { if (mounted.current && identity === request.current) setLoading(false); }
  }
  function begin(kind: 'download' | 'truncate') {
    if (pending.current || loading || !status?.available || !status.generation || status.exporting) return null;
    pending.current = true; setBusy(kind); setError(''); setNotice('');
    read.current?.abort(); request.current++;
    const controller = new AbortController(); action.current = controller;
    const identity = ++operation.current;
    const current = () => {
      if (!mounted.current || identity !== operation.current || controller.signal.aborted) throw new Error('Obsolete diagnostics action');
    };
    return { controller, identity, current };
  }
  function finish(identity: number) {
    if (!mounted.current || identity !== operation.current) return;
    pending.current = false; action.current = null; setBusy(null);
  }
  async function download() {
    const job = begin('download'); if (!job) return;
    try {
      const response = await adminResponse('diagnostics/download', AbortSignal.any([job.controller.signal, AbortSignal.timeout(75_000)]), job.current, {});
      if (!response.headers.get('Content-Type')?.startsWith('application/vnd.sqlite3')) throw new Error('Unexpected download');
      const blob = await response.blob(); job.current();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'spinel-diagnostics.sqlite';
      document.body.append(link); link.click(); link.remove();
      objectUrls.current.set(url, setTimeout(() => { URL.revokeObjectURL(url); objectUrls.current.delete(url); }, 60_000));
      setNotice('Diagnostics snapshot sent to your browser. Check your downloads.');
    } catch (cause) {
      if (mounted.current && job.identity === operation.current && !job.controller.signal.aborted) {
        setDenied(operatorDenied(cause));
        setError(operatorDenied(cause) ? 'Operator access is unavailable. Sign in again with your Operator account.' : 'Diagnostics could not be downloaded. Refresh the status and try again.');
        setStatus(null);
      }
    } finally { finish(job.identity); }
  }
  function cancelDownload() {
    action.current?.abort(); operation.current++;
    pending.current = false; action.current = null; setBusy(null);
    setNotice('Download cancelled. No snapshot was sent to your browser.');
  }
  async function truncate() {
    if (!confirmation || confirmation !== status?.generation) return;
    const job = begin('truncate'); if (!job) return;
    try {
      const response = await adminResponse('diagnostics/truncate', AbortSignal.any([job.controller.signal, AbortSignal.timeout(15_000)]), job.current, { confirm: true, generation: confirmation });
      await response.json(); job.current();
      setConfirmation(null);
      setNotice('Diagnostics cleared. Collection can continue; new records may already appear.');
      await refresh();
    } catch (cause) {
      if (mounted.current && job.identity === operation.current && !job.controller.signal.aborted) {
        setConfirmation(null); setStatus(null); setDenied(operatorDenied(cause));
        if (cause instanceof AdminRequestError && cause.status === 409) {
          const refreshed = await refresh();
          if (refreshed && mounted.current && job.identity === operation.current)
            setError('Diagnostics changed or a download is active. Review the refreshed status, then open Truncate diagnostics and confirm again.');
        } else {
          setError(operatorDenied(cause) ? 'Operator access is unavailable. Sign in again with your Operator account.' : 'The clear request could not be confirmed. Refresh before deciding whether to try again.');
        }
      }
    } finally { finish(job.identity); }
  }
  const disabled = busy !== null || loading || !status?.available || !status.generation || status.exporting;
  return <section className="admin-health-card admin-diagnostics sp-ui" aria-label="Diagnostics">
    <div className="admin-section-heading"><h3>Diagnostics</h3><div className="diagnostics-actions"><Button primary disabled={disabled} onClick={() => void download()}>{busy === 'download' ? 'Downloading…' : 'Download diagnostics'}</Button>
      <ActionMenu label="Diagnostics actions" triggerRef={menu} finalFocus={() => confirmation ? false : menu.current} actions={[{ label: 'Truncate diagnostics…', destructive: true, disabled, onClick: () => { setError(''); setNotice(''); setConfirmation(status?.generation ?? null); } }]} />
    </div></div>
    <p className="sp-muted">Download a consistent SQLite snapshot for local inspection. Automatic records can include user and file IDs, but no document titles, content or credentials. Submitted feedback, when present, is included.</p>
    {loading && <p role="status">Loading diagnostics status…</p>}
    {busy === 'download' && <p role="status">Preparing and downloading the snapshot… <Button onClick={cancelDownload}>Cancel download</Button></p>}
    {!confirmation && error && <p role="alert">{error}</p>}
    {denied && <a href="/sign-in">Sign in again</a>}
    {notice && <p role="status">{notice}</p>}
    {status && (status.available ? <>
      <p className="admin-health-state"><strong>{status.exporting ? 'Download active' : 'Available'}</strong></p>
      {status.exporting && <p>A snapshot is being downloaded. Refresh after it finishes to download or clear diagnostics.</p>}
      <dl className="health-facts"><div><dt>Stored records</dt><dd>{status.recordCount.toLocaleString()}</dd></div><div><dt>Logical record payload</dt><dd>{healthBytes(status.logicalBytes)}</dd></div></dl>
      <details className="diagnostics-loss"><summary>Dropped records since server start</summary><dl className="health-facts">
        <div><dt>Invalid records</dt><dd>{status.dropped.invalid}</dd></div><div><dt>Queue limit</dt><dd>{status.dropped.queue}</dd></div><div><dt>Storage limit</dt><dd>{status.dropped.storage}</dd></div><div><dt>Store unavailable</dt><dd>{status.dropped.unavailable}</dd></div><div><dt>Prior collection</dt><dd>{status.dropped.stale}</dd></div>
      </dl></details>
    </> : <p role="alert">Diagnostics storage is unavailable. Documents and edits remain independent of collection.</p>)}
    <div className="diagnostics-footer"><Button disabled={loading || busy !== null} onClick={() => { setError(''); void refresh(); }}>Refresh diagnostics status</Button><a href="https://github.com/mxbaylee/spinel/blob/main/docs/implementation/SPN-032.md" target="_blank" rel="noopener noreferrer">Open diagnostics guide</a></div>
    {confirmation && <Modal open title="Truncate diagnostics" icon="trash" dismissDisabled={busy !== null} finalFocus={() => menu.current} onOpenChange={(open) => { if (!open) setConfirmation(null); }}>
      <div className="diagnostics-confirmation"><p>Delete all collected diagnostics and submitted feedback? This cannot be undone.</p><p>Feedback flags are cleared too. Files, accounts, backups and collaboration state are not deleted. Collection resumes and new records or reports may appear afterward.</p><p>Clearing records may not shrink the database file immediately.</p>
      <div className="admin-dialog-actions"><Button disabled={busy !== null} onClick={() => setConfirmation(null)}>Cancel</Button><Button className="sp-destructive" disabled={busy !== null} onClick={() => void truncate()}>{busy === 'truncate' ? 'Clearing…' : 'Truncate diagnostics'}</Button></div></div>
    </Modal>}
  </section>;
}
