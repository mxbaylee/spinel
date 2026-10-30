import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { Button, Choice, Modal } from '../src/ui/redesign/Controls.tsx';
import {
  RESTORE_CONSEQUENCES,
  RESTORE_RESOURCE_MESSAGES,
  validRestoreOutcome,
  validRestorePreview,
  validRestoreResources,
  validRestoreVerification,
} from '../src/shared/restore.ts';
import type { RestoreOutcome, RestorePreparation, RestoreStatus } from '../src/shared/restore.ts';
import { capturedMaintenanceEpoch, maintenanceFetch as fetch } from './maintenanceFetch.ts';
import {
  getMaintenanceStatus,
  refreshMaintenanceStatus,
  useMaintenanceStatus,
} from './maintenanceState.ts';
import { api } from './api.ts';
import './administration.css';
import './backup-restore.css';

type Status = RestoreStatus;
type Entry = { id: string; createdAt: number };
type Phase = 'idle' | 'verifying' | 'creating' | 'uploading' | 'confirming' | 'cancelling';
const MAX_ARCHIVE_BYTES = 5 * 1024 ** 3;
const publicRestoreError = Symbol('public restore response');
function publicMessage(failure: unknown, fallback: string) {
  return failure instanceof Error && publicRestoreError in failure ? failure.message : fallback;
}
const active = (job: RestorePreparation | null) =>
  !!job && !['cancelled', 'expired', 'failed'].includes(job.state);
const admitted = (job: RestorePreparation | null) =>
  !!job && ['admitting', 'accepted', 'started'].includes(job.state);
const time = (value: number | string) => new Date(value).toLocaleString();
const size = (bytes: number) =>
  bytes === 0
    ? '0 KiB'
    : bytes >= 1024 ** 3
      ? `${(bytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GiB`
      : bytes < 1024 * 1024
        ? `${Math.max(1, Math.ceil(bytes / 1024))} KiB`
        : `${(bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;
const messages: Record<RestorePreparation['state'], string> = {
  uploading: 'Waiting for the encrypted backup upload.',
  preparing: 'Checking the encrypted backup and preparing an access preview…',
  ready: 'Backup prepared. Review its source and consequences before restoring.',
  admitting: 'Restore confirmation is being recorded. Its source remains protected.',
  accepted: 'The restore source is protected. Maintenance has not yet been confirmed.',
  started:
    'Restore was accepted and maintenance is starting. The final outcome is not yet confirmed.',
  cancelled: 'Restore preparation was cancelled. The live workspace was not replaced.',
  expired: 'Restore preparation expired. Prepare the backup again.',
  failed:
    'Restore preparation failed. Check the encrypted backup, recovery key, compatible application image and free space.',
};
function maintenanceMessage() {
  const status = getMaintenanceStatus();
  if (!status?.available) return '';
  if (status.phase !== 'running')
    return 'The workspace is in maintenance. A running or reachable server does not confirm the restore outcome.';
  const epoch = capturedMaintenanceEpoch();
  return epoch !== undefined && epoch !== status.epoch
    ? 'The workspace changed. Reload Administration before preparing another restore.'
    : '';
}
function requestError(status: number, code?: unknown) {
  return Object.assign(
    new Error(
      code === 'maintenance' || code === 'maintenance-epoch'
        ? 'The workspace changed or entered maintenance. Refresh its status before continuing.'
        : [401, 403, 404].includes(status)
          ? 'Your Operator session is unavailable. Sign in again to check recovery status.'
          : status === 428
            ? 'Passkey verification expired. Refresh restore status before continuing.'
            : status === 409
              ? 'The source, target or recovery operation changed. Refresh restore status before continuing.'
              : 'The restore request could not be confirmed. Refresh its status before trying again.',
    ),
    { status, code, [publicRestoreError]: true },
  );
}

export function BackupRestore({
  currentId,
  onBusyChange,
  authenticate = startAuthentication,
}: {
  currentId: string;
  onBusyChange?: (busy: boolean) => void;
  authenticate?: typeof startAuthentication;
}) {
  const { status: maintenance } = useMaintenanceStatus();
  const paused = !!maintenance?.available && maintenance.phase !== 'running';
  const notice = maintenanceMessage();
  const [available, setAvailable] = useState(false);
  const [known, setKnown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<RestorePreparation | null>(null);
  const [outcome, setOutcome] = useState<RestoreOutcome | null>(null);
  const [pendingRestore, setPendingRestore] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [dialog, setDialog] = useState<'prepare' | 'confirm' | null>(null);
  const [source, setSource] = useState('upload');
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [selection, setSelection] = useState('');
  const [archive, setArchive] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const [originalExpired, setOriginalExpired] = useState(false);
  const mounted = useRef(false),
    operation = useRef(0),
    reads = useRef(0),
    reading = useRef(false);
  const busy = useRef(false),
    challenge = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const confirmed = useRef<{ id: string; confirmation: string } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null),
    prepareButton = useRef<HTMLButtonElement | null>(null);
  const archiveInput = useRef<HTMLInputElement | null>(null),
    keyInput = useRef<HTMLInputElement | null>(null);
  const wasPaused = useRef(paused);
  const archiveId = useId(),
    keyId = useId(),
    acknowledgementId = useId();

  async function request<T>(
    path: string,
    signal: AbortSignal,
    body?: unknown,
    file?: File,
  ): Promise<T> {
    const response = await fetch(`/api/admin/restores${path}`, {
      method: body === undefined && !file ? 'GET' : 'POST',
      signal,
      headers: {
        'X-Spinel-Account': currentId,
        ...(file
          ? { 'Content-Type': 'application/octet-stream' }
          : body === undefined
            ? {}
            : { 'Content-Type': 'application/json' }),
      },
      // A File is streamed by the browser. Only the separate 32-byte key is read into JS.
      ...(file ? { body: file } : body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => null);
      if (failure?.code === 'maintenance' || failure?.code === 'maintenance-epoch')
        void refreshMaintenanceStatus();
      throw requestError(response.status, failure?.code);
    }
    return response.json() as Promise<T>;
  }
  async function refresh(showLoading = true) {
    if (reading.current) return;
    if (getMaintenanceStatus()?.available && getMaintenanceStatus()?.phase !== 'running') {
      setLoading(false);
      return;
    }
    reading.current = true;
    const read = ++reads.current;
    if (showLoading) setLoading(true);
    try {
      const status = await request<Status>('', AbortSignal.timeout(15_000));
      if (!mounted.current || read !== reads.current) return;
      if (
        typeof status.available !== 'boolean' ||
        (status.available ? typeof status.pending !== 'boolean' : status.pending !== null) ||
        (status.outcome !== null && !validRestoreOutcome(status.outcome))
      )
        throw new Error('Incomplete restore status.');
      setAvailable(status.available);
      setKnown(true);
      setOutcome(status.outcome);
      setPendingRestore(status.pending);
      const terminal = status.outcome && status.outcome.state !== 'unresolved';
      const resolvesLocal = terminal && status.outcome?.id === confirmed.current?.id;
      setJob(terminal && status.outcome?.id === status.job?.id ? null : status.job);
      if (resolvesLocal) {
        confirmed.current = null;
        setOutcomeUnknown(false);
        setOriginalExpired(false);
        setDialog(null);
      } else if (!status.job && confirmed.current) setOutcomeUnknown(true);
      if (showLoading) setError('');
    } catch (failure) {
      if (mounted.current && read === reads.current) {
        setKnown(false);
        setError(
          publicMessage(
            failure,
            'Restore status is unavailable. Refresh before choosing another source.',
          ),
        );
        if ([401, 403, 404].includes(Number((failure as { status?: number })?.status))) {
          if (confirmed.current || admitted(job)) setOutcomeUnknown(true);
          setJob(null);
          setOutcome(null);
          setPendingRestore(null);
          clearFiles();
          setDialog(null);
          setAcknowledged(false);
        }
      }
    } finally {
      reading.current = false;
      if (mounted.current && read === reads.current) setLoading(false);
    }
  }
  function endProof() {
    if (challenge.current)
      void api('cancel', { challengeId: challenge.current }, () => {}, {
        accountId: currentId,
      }).catch(() => {});
    challenge.current = null;
  }
  function clearFiles() {
    setArchive(null);
    setKeyFile(null);
    if (archiveInput.current) archiveInput.current.value = '';
    if (keyInput.current) keyInput.current.value = '';
  }
  function cancelDialog() {
    if (phase === 'creating' || phase === 'confirming') return;
    operation.current++;
    controller.current?.abort();
    if (phase === 'verifying') WebAuthnAbortService.cancelCeremony();
    endProof();
    busy.current = false;
    setPhase('idle');
    setDialog(null);
    setAcknowledged(false);
    clearFiles();
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      operation.current++;
      reads.current++;
      controller.current?.abort();
      if (busy.current) WebAuthnAbortService.cancelCeremony();
      endProof();
      // Section changes do not cancel or repeat a server-owned restore.
      onBusyChange?.(false);
    };
  }, [currentId]);
  useEffect(() => {
    onBusyChange?.(phase !== 'idle' || dialog !== null);
  }, [phase, dialog, onBusyChange]);
  useEffect(() => {
    if ((!active(job) && pendingRestore !== true) || paused || phase !== 'idle') return;
    const timer = setInterval(() => void refresh(false), 2000);
    return () => clearInterval(timer);
  }, [job?.id, job?.state, pendingRestore, paused, phase]);
  useEffect(() => {
    const resumed = wasPaused.current && !paused;
    wasPaused.current = paused;
    if (resumed) void refresh();
  }, [paused]);
  async function loadCatalog() {
    if (catalogLoading || maintenanceMessage()) return;
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
  async function verify(check: () => void, signal: AbortSignal) {
    setPhase('verifying');
    const proofSignal = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
    const cancelCeremony = () => WebAuthnAbortService.cancelCeremony();
    const current = () => {
      check();
      proofSignal.throwIfAborted();
    };
    proofSignal.addEventListener('abort', cancelCeremony, { once: true });
    try {
      const options = await api<{
        options: PublicKeyCredentialRequestOptionsJSON;
        challengeId: string;
      }>('reauthentication/options', {}, current, {
        signal: proofSignal,
        accountId: currentId,
        onAbandonedChallenge: (id) =>
          void api('cancel', { challengeId: id }, () => {}, { accountId: currentId }).catch(
            () => {},
          ),
      });
      challenge.current = options.challengeId;
      const response = await authenticate({ optionsJSON: options.options });
      current();
      await api(
        'reauthentication/verify',
        { challengeId: options.challengeId, response },
        current,
        {
          signal: proofSignal,
          accountId: currentId,
        },
      );
    } finally {
      proofSignal.removeEventListener('abort', cancelCeremony);
    }
  }
  function beginAction() {
    busy.current = true;
    // An older status read cannot replace the result of this mutation.
    reads.current++;
    setLoading(false);
    const identity = ++operation.current,
      pending = new AbortController();
    controller.current = pending;
    const signal = AbortSignal.any([pending.signal, AbortSignal.timeout(5 * 60_000)]);
    const check = () => {
      if (!mounted.current || operation.current !== identity || signal.aborted)
        throw new DOMException('Restore request ended.', 'AbortError');
    };
    setError('');
    return { identity, signal, check };
  }
  function endAction(identity: number) {
    if (operation.current !== identity) return;
    endProof();
    busy.current = false;
    if (mounted.current) setPhase('idle');
  }
  async function prepare() {
    if (busy.current || maintenanceMessage() || !available || pendingRestore !== false) return;
    const resumeUpload = job?.state === 'uploading';
    if (
      (source === 'upload' || resumeUpload) &&
      (!archive ||
        archive.size <= 0 ||
        archive.size > MAX_ARCHIVE_BYTES ||
        (!resumeUpload && keyFile?.size !== 32))
    ) {
      setError(
        'Choose a complete encrypted backup up to 5 GiB and its separate 32-byte recovery key.',
      );
      return;
    }
    if (!resumeUpload && source === 'catalog' && !selection) return;
    const { identity, signal, check } = beginAction();
    try {
      if (!resumeUpload) await verify(check, signal);
      check();
      setPhase('creating');
      let result = job;
      if (!resumeUpload) {
        let encoded = '';
        try {
          if (source === 'upload') {
            const bytes = new Uint8Array(await keyFile!.arrayBuffer());
            try {
              check();
              encoded = btoa(String.fromCharCode(...bytes));
            } finally {
              bytes.fill(0);
            }
          }
          result = await request<RestorePreparation>(
            '/preparations',
            signal,
            source === 'upload'
              ? { requestId: crypto.randomUUID(), source, key: encoded }
              : { requestId: crypto.randomUUID(), source, artifactId: selection },
          );
        } finally {
          encoded = '';
          if (mounted.current && identity === operation.current) {
            setKeyFile(null);
            if (keyInput.current) keyInput.current.value = '';
          }
        }
      }
      check();
      reads.current++;
      setJob(result);
      setDialog(null);
      if (result?.state === 'uploading') {
        setPhase('uploading');
        result = await request<RestorePreparation>(
          `/preparations/${encodeURIComponent(result.id)}/upload`,
          signal,
          undefined,
          archive!,
        );
        check();
        setJob(result);
      }
      clearFiles();
    } catch (failure) {
      if (mounted.current && identity === operation.current) {
        setError(
          publicMessage(
            failure,
            'Passkey verification or preparation did not finish. Refresh restore status before trying another source.',
          ),
        );
        setKnown(false);
      }
    } finally {
      endAction(identity);
    }
  }
  async function confirm() {
    if (
      !job?.confirmation ||
      !job.preview ||
      !acknowledged ||
      busy.current ||
      maintenanceMessage() ||
      originalExpired
    )
      return;
    const retry = admitted(job) || confirmed.current?.id === job.id;
    const { identity, signal, check } = beginAction();
    try {
      // Re-verifying an already admitted intent would invalidate its original
      // verified_at. A retry observes/reuses that exact original authorization.
      if (!retry) await verify(check, signal);
      check();
      setPhase('confirming');
      confirmed.current = { id: job.id, confirmation: job.confirmation };
      const result = await request<RestorePreparation>(
        `/preparations/${encodeURIComponent(job.id)}/confirm`,
        signal,
        { confirmation: job.confirmation, consequencesVersion: 1, acceptLostWork: true },
      );
      check();
      reads.current++;
      setJob(result);
      setDialog(null);
      setAcknowledged(false);
      if (result.error)
        setError(
          'The confirmed restore needs attention. Its source remains protected; refresh status or retry the same confirmation.',
        );
      void refreshMaintenanceStatus();
    } catch (failure) {
      if (mounted.current && identity === operation.current) {
        if (confirmed.current) {
          setOutcomeUnknown(true);
          setDialog(null);
        }
        if (retry && Number((failure as { status?: number })?.status) === 428) {
          setOriginalExpired(true);
          setError('');
        } else {
          setError(
            publicMessage(
              failure,
              confirmed.current
                ? 'The confirmation response was lost. Its outcome is unconfirmed. Refresh status before taking another action.'
                : 'Passkey verification did not finish. No restore confirmation was sent.',
            ),
          );
        }
      }
    } finally {
      endAction(identity);
    }
  }
  async function cancelPreparation() {
    if (!job || admitted(job) || confirmed.current || phase === 'cancelling') return;
    operation.current++;
    controller.current?.abort();
    const { identity, signal, check } = beginAction();
    setPhase('cancelling');
    try {
      const result = await request<RestorePreparation>(
        `/preparations/${encodeURIComponent(job.id)}/cancel`,
        signal,
        {},
      );
      check();
      reads.current++;
      setJob(result);
      clearFiles();
      setDialog(null);
      prepareButton.current?.focus();
    } catch {
      if (mounted.current && identity === operation.current)
        setError('Cancellation could not be confirmed. Refresh restore status before continuing.');
    } finally {
      endAction(identity);
    }
  }
  function open(next: 'prepare' | 'confirm') {
    if (busy.current || maintenanceMessage()) return;
    returnFocus.current = document.activeElement as HTMLElement;
    setAcknowledged(false);
    setError('');
    setDialog(next);
  }
  const occupied = active(job),
    retry = admitted(job) || (confirmed.current?.id === job?.id && !!confirmed.current);
  const canReview =
    job?.state === 'ready' &&
    validRestorePreview(job.preview) &&
    validRestoreVerification(job.verification) &&
    validRestoreResources(job.resources) &&
    job.resources.sufficient;
  const resourceFailure = Object.values(RESTORE_RESOURCE_MESSAGES).find(
    (message) => message === job?.error,
  );
  const mayRetry =
    !!job &&
    job.state !== 'started' &&
    ((admitted(job) && !!job.error) || (outcomeUnknown && !!confirmed.current));
  const disabled = loading || !known || !available || phase !== 'idle' || !!notice;
  const blocksNew = pendingRestore !== false || outcome?.state === 'unresolved';
  const evidence = job && job.bytes !== null && job.sourceSha256 && (
    <dl className="restore-source-facts">
      <dt>Backup created</dt>
      <dd>{job.sourceCreatedAt ? time(job.sourceCreatedAt) : 'Unknown'}</dd>
      <dt>Encrypted size</dt>
      <dd>{size(job.bytes)}</dd>
      <dt>Backup fingerprint</dt>
      <dd>
        <code>{job.sourceSha256}</code>
      </dd>
      <dt>Restore target</dt>
      <dd>This workspace at {location.origin}</dd>
    </dl>
  );
  const preview = job?.preview && (
    <div className="restore-preview">
      <h4>Provisional access changes</h4>
      <dl className="restore-source-facts">
        <dt>Current accounts / passkeys kept</dt>
        <dd>
          {job.preview.currentAccounts} / {job.preview.currentPasskeys}
        </dd>
        <dt>Sharing removed / downgraded</dt>
        <dd>
          {job.preview.sharingRemoved} / {job.preview.sharingDowngraded}
        </dd>
        <dt>Items / ownership groups isolated</dt>
        <dd>
          {job.preview.isolatedItems} / {job.preview.isolatedGroups}
        </dd>
        <dt>Items separated from old folders</dt>
        <dd>{job.preview.detachedRoots}</dd>
        <dt>Deleted-work groups held for recovery</dt>
        <dd>{job.preview.heldTrashBatches}</dd>
      </dl>
      <p className="sp-muted">
        These counts may change when the workspace stops accepting work. Confirmation covers the
        full loss and access changes.
      </p>
    </div>
  );
  const verification = job && validRestoreVerification(job.verification) && (
    <div className="restore-preview">
      <h4>Verified backup</h4>
      <p>
        Matches this workspace and application. The encrypted bundle, database integrity and
        inventory, document snapshots and images passed verification.
      </p>
      <p className="sp-muted">
        {job.verification.tables} tables · {job.verification.rows} rows ·{' '}
        {job.verification.snapshots} snapshots · {job.verification.images} images
      </p>
      <p className="sp-muted">
        Application startup and current access are checked during the supervised restore.
      </p>
    </div>
  );
  const resources = job && validRestoreResources(job.resources) && (
    <div className="restore-preview" aria-label="Estimated disk space">
      <h4>Estimated disk space</h4>
      <dl className="restore-source-facts">
        {job.resources.filesystems.map((filesystem) => (
          <Fragment key={filesystem.purposes.join('-')}>
            <dt>
              {filesystem.purposes
                .map(
                  (purpose) =>
                    ({
                      application: 'Application',
                      recovery: 'Recovery',
                      preparation: 'Preparation',
                    })[purpose],
                )
                .join(' / ')}{' '}
              volume
            </dt>
            <dd>
              {size(filesystem.requiredAdditionalBytes)} additional needed;{' '}
              {size(filesystem.availableBytes)} available
            </dd>
          </Fragment>
        ))}
      </dl>
      <p className="sp-muted">
        Provisional estimate, checked {time(job.resources.checkedAt)}. Space is checked again before
        editing is paused and is not reserved. Later database growth can require more space.
      </p>
      {!job.resources.sufficient && (
        <p role="alert">
          Not enough disk space. Free space and prepare again. Editing has not been paused.
        </p>
      )}
    </div>
  );
  return (
    <section className="admin-health-card admin-restore sp-ui" aria-label="Restore workspace">
      <div className="admin-section-heading">
        <h3>Restore workspace</h3>
        <Button disabled={loading || phase !== 'idle' || paused} onClick={() => void refresh()}>
          Refresh restore status
        </Button>
      </div>
      <p>
        Prepare an encrypted backup and review its consequences before maintenance begins. Document
        contents stay private.
      </p>
      <div className="restore-status" aria-live="polite" aria-atomic="true">
        {loading && <p role="status">Loading restore status…</p>}
        {known && !available && (
          <p role="status">
            Supervised restore is unavailable. Follow the recovery guide to check this deployment.
          </p>
        )}
        {job && !originalExpired && (
          <p role={job.state === 'failed' || (job.error && admitted(job)) ? 'alert' : 'status'}>
            {phase === 'uploading'
              ? 'Uploading and checking the encrypted backup…'
              : job.error && admitted(job)
                ? (resourceFailure ??
                  'The confirmed restore needs attention. Its source remains protected; check status or retry the same confirmation.')
                : job.state === 'failed' && resourceFailure
                  ? resourceFailure
                  : messages[job.state]}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {outcomeUnknown && !originalExpired && outcome?.state !== 'unresolved' && (
          <p role="status">
            The restore outcome has not been confirmed. If your session ends, sign in again and
            check recovery status. Server availability alone is not a restore result.
          </p>
        )}
        {originalExpired && (
          <p role="alert">
            The original confirmation expired, and the restore outcome is unconfirmed. Refresh
            restore status or follow the recovery guide to check the outcome. A new passkey check
            cannot renew this restore.
          </p>
        )}
        {error && !dialog && <p role="alert">{error}</p>}
      </div>
      {outcome && (
        <div className="restore-preview" aria-label="Recorded restore outcome">
          <h4>Recorded restore outcome</h4>
          <p role={outcome.state === 'unresolved' ? 'alert' : 'status'}>
            {outcome.state === 'backup-restored'
              ? 'Backup restored. This records the completed restore; later edits may have changed the workspace.'
              : outcome.state === 'original-recovered'
                ? 'The backup restore did not succeed. Original content was recovered. Access and sessions may have changed.'
                : outcome.state === 'did-not-start'
                  ? 'Restore did not begin. This attempt did not replace the workspace.'
                  : 'The restore outcome is unconfirmed. Refresh status or follow the recovery guide before starting another restore.'}
          </p>
          <dl className="restore-source-facts">
            <dt>Restore ID</dt>
            <dd>
              <code>{outcome.id}</code>
            </dd>
            <dt>Recorded</dt>
            <dd>{time(outcome.updatedAt)}</dd>
            <dt>Selected encrypted backup</dt>
            <dd>{size(outcome.source.bytes)}</dd>
            <dt>Backup fingerprint</dt>
            <dd>
              <code>{outcome.source.sha256}</code>
            </dd>
          </dl>
        </div>
      )}
      {pendingRestore && !outcome && !admitted(job) && (
        <p role="status">
          A restore still needs attention. Refresh status before preparing another restore.
        </p>
      )}
      {job?.state === 'ready' && evidence}
      {job?.state === 'ready' && verification}
      {(job?.state === 'ready' || job?.state === 'failed') && resources}
      {job?.state === 'ready' && preview}
      {!originalExpired && (
        <div className="restore-actions">
          {canReview || mayRetry ? (
            <Button
              primary
              disabled={disabled || originalExpired || (!mayRetry && blocksNew)}
              onClick={() => open('confirm')}
            >
              {mayRetry ? 'Retry confirmed restore' : 'Review restore'}
            </Button>
          ) : job?.state === 'uploading' && phase === 'idle' ? (
            <Button
              primary
              disabled={disabled || blocksNew}
              onClick={() => {
                setSource('upload');
                open('prepare');
              }}
            >
              Continue upload
            </Button>
          ) : (
            <Button
              primary
              ref={prepareButton}
              disabled={disabled || occupied || outcomeUnknown || blocksNew}
              onClick={() => open('prepare')}
            >
              Prepare restore
            </Button>
          )}
          {occupied && !admitted(job) && !confirmed.current && (
            <Button
              disabled={phase === 'cancelling' || !!notice}
              onClick={() => void cancelPreparation()}
            >
              Cancel preparation
            </Button>
          )}
        </div>
      )}
      <a
        href="https://github.com/mxbaylee/spinel/blob/main/docs/backups.md"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open recovery guide
      </a>
      <Modal
        open={dialog === 'prepare'}
        title={
          job?.state === 'uploading' ? 'Continue encrypted upload' : 'Prepare workspace restore'
        }
        icon="upload"
        description="Preparation verifies the backup without replacing the live workspace."
        dismissDisabled={phase === 'creating'}
        onOpenChange={(next) => {
          if (!next) cancelDialog();
        }}
        finalFocus={() =>
          returnFocus.current?.isConnected ? returnFocus.current : prepareButton.current
        }
      >
        <div className="restore-form">
          {job?.state !== 'uploading' && (
            <Choice
              label="Backup source"
              value={source}
              disabled={phase !== 'idle'}
              options={[
                { value: 'upload', label: 'Encrypted backup from this device' },
                { value: 'catalog', label: 'Previously saved backup' },
              ]}
              onChange={(value) => {
                setSource(value);
                if (value === 'catalog' && entries === null) void loadCatalog();
              }}
            />
          )}
          {source === 'upload' ? (
            <>
              <label htmlFor={archiveId}>
                Encrypted workspace backup
                <input
                  id={archiveId}
                  ref={archiveInput}
                  type="file"
                  accept=".spinel,application/octet-stream"
                  disabled={phase !== 'idle'}
                  onChange={(event) => setArchive(event.target.files?.[0] ?? null)}
                />
              </label>
              <p className="sp-muted">
                Choose the complete encrypted bundle, up to 5 GiB. A SQLite database file cannot be
                restored here.
              </p>
              {job?.state !== 'uploading' && (
                <>
                  <label htmlFor={keyId}>
                    Separate recovery key
                    <input
                      id={keyId}
                      ref={keyInput}
                      type="file"
                      disabled={phase !== 'idle'}
                      onChange={(event) => setKeyFile(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <p className="sp-muted">
                    Choose the original 32-byte key file. Its bytes are sent privately for this
                    preparation and then removed.
                  </p>
                </>
              )}
            </>
          ) : (
            <>
              {catalogLoading ? (
                <p role="status">Loading saved backups…</p>
              ) : entries?.length ? (
                <Choice
                  label="Saved backup"
                  value={selection}
                  disabled={phase !== 'idle'}
                  options={[
                    { value: '', label: 'Choose a recovery point' },
                    ...entries.map((entry) => ({ value: entry.id, label: time(entry.createdAt) })),
                  ]}
                  onChange={setSelection}
                />
              ) : entries ? (
                <p>
                  No complete saved backups are available. You can upload an encrypted backup
                  instead.
                </p>
              ) : null}
              {catalogError && <p role="alert">{catalogError}</p>}
              <Button
                disabled={catalogLoading || phase !== 'idle'}
                onClick={() => void loadCatalog()}
              >
                Refresh saved backups
              </Button>
            </>
          )}
          {phase === 'verifying' && <p role="status">Waiting for your passkey…</p>}
          {phase === 'creating' && <p role="status">Recording the preparation…</p>}
          {error && <p role="alert">{error}</p>}
          {!known && (
            <Button disabled={loading || phase !== 'idle'} onClick={() => void refresh()}>
              Refresh restore status
            </Button>
          )}
          <div className="admin-dialog-actions">
            <Button disabled={phase === 'creating'} onClick={cancelDialog}>
              Cancel
            </Button>
            <Button
              primary
              disabled={
                !known ||
                phase !== 'idle' ||
                !!notice ||
                (source === 'catalog'
                  ? !selection
                  : !archive || (job?.state !== 'uploading' && !keyFile))
              }
              onClick={() => void prepare()}
            >
              {job?.state === 'uploading' ? 'Upload encrypted backup' : 'Verify and prepare'}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={dialog === 'confirm'}
        title="Restore this workspace?"
        icon="warning"
        description="Review the exact backup and accept the complete loss and access changes."
        dismissDisabled={phase === 'confirming'}
        onOpenChange={(next) => {
          if (!next) cancelDialog();
        }}
        finalFocus={() =>
          returnFocus.current?.isConnected ? returnFocus.current : prepareButton.current
        }
      >
        {evidence}
        {verification}
        {resources}
        <ul className="restore-consequences">
          {RESTORE_CONSEQUENCES.map((consequence) => (
            <li key={consequence}>{consequence}</li>
          ))}
        </ul>
        <p className="sp-muted">
          Access-change counts are provisional. Work accepted before maintenance drains is included
          in the loss warning.
        </p>
        {retry && (
          <p>
            The original source and confirmation remain fixed. Retrying does not extend that
            authorization.
          </p>
        )}
        <label className="restore-acknowledgement" htmlFor={acknowledgementId}>
          <input
            id={acknowledgementId}
            type="checkbox"
            checked={acknowledged}
            disabled={phase !== 'idle'}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>I accept losing newer work and all the access changes listed above.</span>
        </label>
        {phase === 'verifying' && <p role="status">Waiting for your passkey…</p>}
        {phase === 'confirming' && <p role="status">Recording restore confirmation…</p>}
        {error && <p role="alert">{error}</p>}
        <div className="admin-dialog-actions">
          <Button disabled={phase === 'confirming'} onClick={cancelDialog}>
            Cancel
          </Button>
          <Button
            className="sp-destructive"
            disabled={!acknowledged || phase !== 'idle' || !!notice || originalExpired}
            onClick={() => void confirm()}
          >
            {retry ? 'Retry confirmed restore' : 'Verify and restore workspace'}
          </Button>
        </div>
      </Modal>
    </section>
  );
}
