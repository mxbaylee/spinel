import { useEffect, useId, useRef, useState } from 'react';
import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { Button, Choice, Modal } from '../src/ui/redesign/Controls.tsx';
import { api } from './api.ts';
import './backup-downloads.css';

export interface BackupPolicy {
  automatic: boolean;
  manualDownload: boolean;
  manualReady: boolean;
  manualUnavailable: string | null;
  backupHourUtc: number;
  retention: { daily: number; weekly: number; monthly: number };
  maxArchiveBytes: number;
}
export interface BackupExportJob {
  id: string;
  state: 'preparing' | 'ready' | 'downloading' | 'delivered' | 'cancelled' | 'expired' | 'failed';
  createdAt: number;
  expiresAt: number | null;
  bytes: number | null;
  keyId: string | null;
  error: string | null;
}
type Entry = { id: string; createdAt: number };
type Action = { kind: 'prepare'; artifactId?: string } | { kind: 'download'; id: string };
const active = (job: BackupExportJob | null) =>
  !!job && ['preparing', 'ready', 'downloading'].includes(job.state);
const size = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.ceil(bytes / 1024))} KiB`
    : `${(bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;
const time = (value: number) => new Date(value).toLocaleString();
const messages: Record<BackupExportJob['state'], string> = {
  preparing: 'Preparing encrypted backup…',
  ready: 'Encrypted backup ready.',
  downloading: 'Sending backup to your browser…',
  delivered:
    'Backup sent to your browser. Check that the download finished and keep a separate recovery key.',
  cancelled: 'Backup preparation or delivery was cancelled.',
  expired: 'This download expired. Prepare another backup to try again.',
  failed: 'The backup could not be prepared or delivered. Check the backup guide and try again.',
};

function requestError(status: number) {
  return Object.assign(
    new Error(
      [401, 403, 404].includes(status)
        ? 'Operator access is unavailable. Sign in again with your Operator account.'
        : status === 428
          ? 'Verify with a passkey again before preparing or downloading this backup.'
          : status === 409
            ? 'The backup request could not start. Refresh the status and wait for any active recovery job to finish.'
            : 'The backup request could not be confirmed. Refresh the status and try again.',
    ),
    { status },
  );
}

export function BackupDownloads({
  currentId,
  policy,
  hasDestination,
  authenticate = startAuthentication,
}: {
  currentId: string;
  policy: BackupPolicy;
  hasDestination: boolean;
  authenticate?: typeof startAuthentication;
}) {
  const [job, setJob] = useState<BackupExportJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusKnown, setStatusKnown] = useState(false);
  const [error, setError] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [phase, setPhase] = useState<'idle' | 'verifying' | 'requesting'>('idle');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [selection, setSelection] = useState('');
  const mounted = useRef(false);
  const operation = useRef(0);
  const reads = useRef(0);
  const busy = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const proofUntil = useRef(0);
  const challenge = useRef<string | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const prepareButton = useRef<HTMLButtonElement>(null);
  const downloadButton = useRef<HTMLButtonElement>(null);
  const frameName = useId();
  const frame = useRef<HTMLIFrameElement>(null);
  const deliveryPath = useRef<string | null>(null);

  function deliveryLoaded() {
    if (!mounted.current || !deliveryPath.current) return;
    try {
      const loaded = frame.current?.contentWindow?.location;
      if (!loaded || loaded.href === 'about:blank') return;
      if (loaded.origin !== location.origin || loaded.pathname !== deliveryPath.current) return;
    } catch {
      // A redirected response cannot be trusted as a completed file handoff.
    }
    // An attachment is handled by the download manager, not rendered in the
    // iframe. A loaded error response is not delivery, regardless of its body.
    // Clearing proof conservatively covers a 428 without exposing response text.
    deliveryPath.current = null;
    proofUntil.current = 0;
    setError('The download could not start. Verify with a passkey and try downloading again.');
  }

  async function request<T>(path: string, signal: AbortSignal, body?: unknown) {
    const response = await fetch(`/api/admin/backups${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: {
        'X-Spinel-Account': currentId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw requestError(response.status);
    return (await response.json()) as T;
  }

  async function refresh(showLoading = true) {
    const read = ++reads.current;
    if (showLoading) setLoading(true);
    try {
      const result = await request<{ job: BackupExportJob | null }>(
        '/exports',
        AbortSignal.timeout(15_000),
      );
      if (mounted.current && read === reads.current) {
        setJob(result.job);
        setStatusKnown(true);
        if (showLoading) setError('');
      }
    } catch {
      if (mounted.current && read === reads.current) {
        setStatusKnown(false);
        setError('Download status is unavailable. Refresh before trying another backup.');
      }
    } finally {
      if (mounted.current && read === reads.current) setLoading(false);
    }
  }

  function endProof() {
    if (phase === 'verifying') WebAuthnAbortService.cancelCeremony();
    if (challenge.current)
      void api('cancel', { challengeId: challenge.current }, () => {}, {
        accountId: currentId,
      }).catch(() => {});
    challenge.current = null;
  }
  function cancelAction() {
    operation.current++;
    controller.current?.abort();
    endProof();
    busy.current = false;
    setPhase('idle');
    setAction(null);
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      operation.current++;
      reads.current++;
      controller.current?.abort();
      // No server export is cancelled merely because the Operator changes section.
      // Returning to this browser session can recover its bounded job.
      if (busy.current) WebAuthnAbortService.cancelCeremony();
      if (challenge.current) void api('cancel', { challengeId: challenge.current }).catch(() => {});
    };
  }, [currentId]);
  useEffect(() => {
    if (!active(job)) return;
    const timer = setInterval(() => void refresh(false), 2000);
    return () => clearInterval(timer);
  }, [job?.id, job?.state]);
  useEffect(() => {
    if (job && !active(job)) deliveryPath.current = null;
  }, [job?.id, job?.state]);

  async function loadCatalog() {
    if (catalogLoading) return;
    setCatalogLoading(true);
    setCatalogError('');
    try {
      const result = await request<{ entries: Entry[] }>('/catalog', AbortSignal.timeout(15_000));
      if (mounted.current) {
        setEntries(result.entries);
        setSelection('');
      }
    } catch {
      if (mounted.current) {
        setEntries(null);
        setCatalogError('Saved backups could not be loaded. Refresh the list to try again.');
      }
    } finally {
      if (mounted.current) setCatalogLoading(false);
    }
  }
  function open(next: Action) {
    if (busy.current || !policy.manualDownload) return;
    returnFocus.current = document.activeElement as HTMLElement;
    setError('');
    setAction(next);
  }
  async function perform() {
    if (!action || busy.current) return;
    if (!policy.manualDownload) {
      setError('Workspace downloads are turned off in the deployment configuration.');
      return;
    }
    busy.current = true;
    const identity = ++operation.current;
    const pending = new AbortController();
    controller.current = pending;
    const timeout = setTimeout(() => {
      pending.abort();
      WebAuthnAbortService.cancelCeremony();
    }, 60_000);
    const check = () => {
      if (!mounted.current || operation.current !== identity || pending.signal.aborted)
        throw new DOMException('The backup request ended.', 'AbortError');
    };
    setError('');
    try {
      if (proofUntil.current <= Date.now()) {
        setPhase('verifying');
        const options = await api<{
          options: PublicKeyCredentialRequestOptionsJSON;
          challengeId: string;
        }>('reauthentication/options', {}, check, {
          signal: pending.signal,
          accountId: currentId,
          onAbandonedChallenge: (id) => void api('cancel', { challengeId: id }).catch(() => {}),
        });
        challenge.current = options.challengeId;
        const response = await authenticate({ optionsJSON: options.options });
        check();
        const proof = await api<{ verifiedUntil: number }>(
          'reauthentication/verify',
          { challengeId: options.challengeId, response },
          check,
          { signal: pending.signal, accountId: currentId },
        );
        proofUntil.current = proof.verifiedUntil;
      }
      setPhase('requesting');
      if (action.kind === 'prepare') {
        const result = await request<{ job: BackupExportJob }>(
          '/exports',
          pending.signal,
          action.artifactId ? { artifactId: action.artifactId } : {},
        );
        check();
        reads.current++;
        setJob(result.job);
      } else {
        const result = await request<{ token: string; expiresAt: number }>(
          `/exports/${encodeURIComponent(action.id)}/authorize`,
          pending.signal,
          {},
        );
        check();
        if (result.expiresAt <= Date.now()) throw requestError(428);
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = `/api/admin/backups/exports/${encodeURIComponent(action.id)}/file`;
        form.target = frameName;
        form.hidden = true;
        for (const [name, value] of Object.entries({ token: result.token, accountId: currentId })) {
          const input = document.createElement('input');
          input.type = 'hidden';
          input.name = name;
          input.value = value;
          form.append(input);
        }
        document.body.append(form);
        try {
          // Native form delivery streams to the download manager. Do not buffer
          // the workspace archive with fetch(), blob(), or an object URL.
          deliveryPath.current = new URL(form.action, location.href).pathname;
          form.submit();
        } finally {
          form.remove();
        }
      }
      setAction(null);
      void refresh(false);
    } catch (failure) {
      if (mounted.current && identity === operation.current) {
        if ((failure as { status?: number })?.status === 428) proofUntil.current = 0;
        setError(
          failure instanceof Error && 'status' in failure
            ? requestError(Number(failure.status)).message
            : 'Passkey verification or the backup request did not finish. Refresh the status and try again.',
        );
      }
    } finally {
      clearTimeout(timeout);
      if (identity === operation.current) {
        endProof();
        busy.current = false;
        if (mounted.current) setPhase('idle');
      }
    }
  }
  async function cancelJob() {
    if (!job || busy.current) return;
    busy.current = true;
    const identity = ++operation.current;
    const pending = new AbortController();
    controller.current = pending;
    const timeout = setTimeout(() => pending.abort(), 15_000);
    setPhase('requesting');
    setError('');
    try {
      const result = await request<{ job: BackupExportJob }>(
        `/exports/${encodeURIComponent(job.id)}/cancel`,
        pending.signal,
        {},
      );
      if (mounted.current && identity === operation.current) {
        reads.current++;
        setJob(result.job);
        deliveryPath.current = null;
        if (frame.current) frame.current.src = 'about:blank';
        prepareButton.current?.focus();
      }
    } catch {
      if (mounted.current && identity === operation.current)
        setError('Cancellation could not be confirmed. Refresh the download status and try again.');
    } finally {
      clearTimeout(timeout);
      if (identity === operation.current) {
        busy.current = false;
        if (mounted.current) setPhase('idle');
      }
    }
  }
  const occupied = active(job);
  const disabled = loading || !statusKnown || phase !== 'idle';
  const state = job?.state;
  return (
    <section className="admin-backup-downloads" aria-label="Workspace backup download">
      <h4>Encrypted workspace download</h4>
      <p className="sp-muted">
        Keep a recovery copy of the workspace. Its recovery key is kept separately and is never
        included in this download.
      </p>
      {!policy.manualReady && (
        <p>
          {policy.manualDownload
            ? 'Downloads are unavailable. Check the recovery key and application configuration in the backup guide.'
            : 'Workspace downloads are turned off in the deployment configuration.'}
        </p>
      )}
      <div className="admin-backup-actions">
        {job?.state === 'ready' ? (
          <Button
            primary
            ref={downloadButton}
            disabled={disabled || !policy.manualDownload}
            onClick={() => open({ kind: 'download', id: job.id })}
          >
            Download encrypted backup
          </Button>
        ) : (
          <Button
            primary
            ref={prepareButton}
            disabled={disabled || occupied || !policy.manualReady}
            onClick={() => open({ kind: 'prepare' })}
          >
            Prepare workspace backup
          </Button>
        )}
        {occupied && (
          <Button disabled={phase !== 'idle'} onClick={() => void cancelJob()}>
            {state === 'downloading' ? 'Cancel delivery' : 'Cancel backup'}
          </Button>
        )}
        <Button disabled={loading || phase !== 'idle'} onClick={() => void refresh()}>
          Refresh download status
        </Button>
      </div>
      <div className="admin-backup-job" aria-live="polite" aria-atomic="true">
        {loading && <p role="status">Loading download status…</p>}
        {job && (
          <>
            <p role={state === 'failed' ? 'alert' : 'status'}>{messages[job.state]}</p>
            {state === 'ready' && (
              <p>
                {job.bytes !== null && `${size(job.bytes)} · `}
                {job.expiresAt !== null && `Download available until ${time(job.expiresAt)}.`}
              </p>
            )}
            {job.keyId && ['ready', 'downloading'].includes(job.state) && (
              <p>Recovery key: {job.keyId}</p>
            )}
          </>
        )}
      </div>
      {error && !action && <p role="alert">{error}</p>}
      <p className="sp-muted">
        A download does not confirm an offsite copy or a successful restore. Keep the file and its
        key somewhere you can reach if this server is lost.
      </p>
      {hasDestination && (
        <details
          className="admin-backup-catalog"
          onToggle={(event) => {
            setCatalogOpen(event.currentTarget.open);
            if (event.currentTarget.open && entries === null) void loadCatalog();
          }}
        >
          <summary>Previously saved backups</summary>
          {catalogOpen && (
            <>
              <p>Download a complete backup from the configured destination.</p>
              {catalogLoading ? (
                <p role="status">Loading saved backups…</p>
              ) : entries?.length ? (
                <Choice
                  label="Saved backup"
                  value={selection}
                  disabled={disabled || occupied}
                  options={[
                    { value: '', label: 'Choose a recovery point' },
                    ...entries.map((entry) => ({ value: entry.id, label: time(entry.createdAt) })),
                  ]}
                  onChange={setSelection}
                />
              ) : entries ? (
                <p>No complete backups are available yet.</p>
              ) : null}
              {catalogError && <p role="alert">{catalogError}</p>}
              <div className="admin-backup-actions">
                <Button
                  disabled={disabled || occupied || !selection || !policy.manualReady}
                  onClick={() => open({ kind: 'prepare', artifactId: selection })}
                >
                  Prepare selected backup
                </Button>
                <Button disabled={catalogLoading} onClick={() => void loadCatalog()}>
                  Refresh saved backups
                </Button>
              </div>
            </>
          )}
        </details>
      )}
      <iframe
        ref={frame}
        name={frameName}
        title="Encrypted backup delivery"
        onLoad={deliveryLoaded}
        hidden
      />
      <Modal
        open={action !== null}
        title={
          action?.kind === 'download' ? 'Download encrypted backup' : 'Prepare encrypted backup'
        }
        icon="key"
        description="Confirm your Operator account with a passkey to continue."
        dismissDisabled={phase === 'requesting'}
        onOpenChange={(next) => {
          if (!next) cancelAction();
        }}
        finalFocus={() =>
          downloadButton.current ?? prepareButton.current ?? returnFocus.current ?? false
        }
      >
        <p>
          The encrypted file contains the workspace and recovery settings. You will need the
          separate recovery key to restore it; no document contents are displayed here.
        </p>
        {phase === 'verifying' && <p role="status">Waiting for your passkey…</p>}
        {phase === 'requesting' && <p role="status">Requesting your backup…</p>}
        {error && <p role="alert">{error}</p>}
        <div className="admin-dialog-actions">
          <Button disabled={phase === 'requesting'} onClick={cancelAction}>
            Cancel
          </Button>
          <Button
            primary
            disabled={phase !== 'idle' || !policy.manualDownload}
            onClick={() => void perform()}
          >
            {action?.kind === 'download' ? 'Verify and download' : 'Verify and prepare backup'}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
