import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { startAuthentication, WebAuthnAbortService } from '@simplewebauthn/browser';
import type { PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import type {
  MaintenanceAdminStatus,
  MaintenanceControlResult,
  MaintenancePublicStatus,
} from '../src/shared/maintenance.ts';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { ActionMenu, Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { api } from './api.ts';
import { offlineEpoch } from './offline/offlineStore.ts';
import { refreshMaintenanceStatus, useMaintenanceStatus } from './maintenanceState.ts';
import { capturedMaintenanceEpoch } from './maintenanceFetch.ts';
import { maintenanceInstants, maintenanceOffset, maintenanceTime } from './maintenanceTime.ts';
import { useMaintenanceDismissal } from './useMaintenanceDismissal.ts';
import './administration.css';
import './maintenance.css';

const guide = 'https://github.com/mxbaylee/spinel/blob/main/docs/maintenance.md';
const unavailable: MaintenanceAdminStatus = {
  available: false,
  phase: 'running',
  epoch: '',
  notice: null,
  operationId: null,
  authorityExpiresAt: null,
  generationId: '',
  lastFailure: null,
  readyToResume: false,
};

const phaseLabel = (phase: MaintenancePublicStatus['phase']) => {
  switch (phase) {
    case 'running':
      return 'Edits enabled';
    case 'draining':
      return 'Pausing edits';
    case 'starting':
      return 'Checking the workspace';
    default:
      return 'Edits paused';
  }
};

/** Public status only: guests never receive an Operator name, job ID or recovery detail. */
export function MaintenanceBanner({
  status,
  reachable = true,
  guest = false,
}: {
  status: MaintenancePublicStatus | null;
  reachable?: boolean;
  guest?: boolean;
}) {
  const { dismissed, dismiss, reopen } = useMaintenanceDismissal(status);
  const details = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  if (!status?.available) return null;
  const paused = status.phase !== 'running';
  const notice = status.notice?.state !== 'cancelled' ? status.notice : null;
  if (!paused && (!notice || dismissed)) return null;
  const title = paused
    ? phaseLabel(status.phase)
    : notice?.state === 'scheduled'
      ? 'Maintenance scheduled'
      : 'Maintenance window';
  return (
    <section
      className="maintenance-banner sp-ui"
      aria-label="Workspace maintenance"
      data-dismissed={dismissed || undefined}
    >
      <details ref={details}>
        <summary ref={summary} onClick={() => dismissed && reopen()}>
          <ProfileIcon icon={paused ? 'lucide:pause' : 'lucide:calendar-clock'} size={18} />
          <span className="maintenance-banner-summary" role="status">
            <strong>
              {title}
              {dismissed && !reachable && ' · reconnecting'}
            </strong>
            {!dismissed && (
              <span>
                {!reachable
                  ? 'Last known status · reconnecting'
                  : paused
                    ? 'Keep this tab open for pending changes.'
                    : notice
                      ? maintenanceTime(notice.startsAt)
                      : ''}
              </span>
            )}
          </span>
          <span className="maintenance-banner-details">Details</span>
        </summary>
        <div className="maintenance-banner-content">
          {paused ? (
            <p>
              Already acknowledged edits remain saved. Keep this tab open for changes still waiting
              to sync; check the document’s save indicator before leaving.
            </p>
          ) : (
            <p>
              Check the save indicator before maintenance begins. A scheduled notice does not pause
              edits automatically.
            </p>
          )}
          {notice && (
            <p>
              {maintenanceTime(notice.startsAt, notice.timeZone)} ({notice.timeZone}); about{' '}
              {notice.durationMinutes} minutes.{' '}
              {notice.state === 'missed' &&
                'The announced window has passed; wait for an updated status.'}
            </p>
          )}
          {!guest && <p>Devices without a connection may not have received this notice.</p>}
          {!reachable && <p>Current maintenance status could not be checked. Retrying…</p>}
        </div>
      </details>
      {!dismissed && (
        <Button
          type="button"
          className="maintenance-banner-dismiss"
          aria-label="Dismiss for now"
          title="Dismiss for now"
          onClick={(event) => {
            if (details.current) details.current.open = false;
            dismiss();
            if (paused) summary.current?.focus({ preventScroll: true });
            else
              event.currentTarget
                .closest<HTMLElement>('.maintenance-shell')
                ?.focus({ preventScroll: true });
          }}
        >
          <ProfileIcon icon="lucide:x" size={18} />
        </Button>
      )}
    </section>
  );
}

/** The surrounding shell stays mounted throughout maintenance and keeps native buffers alive. */
export function MaintenanceShell({
  children,
  guest = false,
}: {
  children: ReactNode;
  guest?: boolean;
}) {
  const { status, reachable } = useMaintenanceStatus();
  const band = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = band.current;
    if (!element) return;
    const measure = () => setHeight(Math.ceil(element.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="maintenance-shell"
      tabIndex={-1}
      data-announced={height > 0 || undefined}
      style={{ '--sp-maintenance-height': `${height}px` } as CSSProperties}
    >
      <div ref={band} className="maintenance-band">
        <MaintenanceBanner status={status} reachable={reachable} guest={guest} />
      </div>
      {children}
    </div>
  );
}

type Confirmation = 'pause' | 'notice' | 'cancel-notice';
type ResumeAuthority = { operationId: string; token: string; expiresAt: number };

function localNextHour() {
  const date = new Date(Date.now() + 3_600_000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function MaintenanceControls({
  currentId,
  onBusyChange,
  reloadDisabled = false,
  authenticate = startAuthentication,
}: {
  currentId: string;
  onBusyChange?: (busy: boolean) => void;
  reloadDisabled?: boolean;
  authenticate?: typeof startAuthentication;
}) {
  const [status, setStatus] = useState<MaintenanceAdminStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'verify' | 'submit' | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reloadRequired, setReloadRequired] = useState(false);
  const [verifiedUntil, setVerifiedUntil] = useState(0);
  const [now, setNow] = useState(Date.now);
  const [localTime, setLocalTime] = useState(localNextHour);
  const [timeZone, setTimeZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  );
  const [duration, setDuration] = useState('30');
  const [occurrence, setOccurrence] = useState('');
  const mounted = useRef(false);
  const locked = useRef(false);
  const verifying = useRef(false);
  const serial = useRef(0);
  const readSerial = useRef(0);
  const readRequest = useRef<AbortController | null>(null);
  const actionRequest = useRef<AbortController | null>(null);
  const challenge = useRef<string | null>(null);
  const operation = useRef<string | null>(null);
  const resume = useRef<ResumeAuthority | null>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const [verifyAccount] = useState(() => {
    try {
      return offlineEpoch();
    } catch {
      // Server requests remain bound to the displayed account when browser
      // storage is blocked; storage is not a prerequisite for Operator access.
      return () => {};
    }
  });
  const instants = useMemo(() => {
    try {
      return { values: maintenanceInstants(localTime, timeZone.trim()), error: '' };
    } catch {
      return { values: [], error: 'Choose a valid date, time and time zone.' };
    }
  }, [localTime, timeZone]);
  const startsAt =
    instants.values.length === 1
      ? instants.values[0]
      : occurrence && instants.values.includes(Number(occurrence))
        ? Number(occurrence)
        : null;
  const durationMinutes = Number(duration);
  const latestNoticeAt = now + 365 * 86_400_000;
  const validNotice = Boolean(
    startsAt &&
    startsAt > now &&
    startsAt <= latestNoticeAt &&
    Number.isInteger(durationMinutes) &&
    durationMinutes >= 1 &&
    durationMinutes <= 1440,
  );
  const ownsResume = Boolean(
    resume.current &&
    status?.operationId === resume.current.operationId &&
    resume.current.expiresAt > now &&
    status.phase !== 'running',
  );
  const canResume = Boolean(ownsResume && status?.readyToResume);
  const needsServerControl = Boolean(
    status?.available && status.phase !== 'running' && !ownsResume && status.phase !== 'draining',
  );

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const polling = setInterval(() => {
      if (resume.current && resume.current.expiresAt <= Date.now()) resume.current = null;
      setNow(Date.now());
      if (!locked.current) void refresh(false);
    }, 5000);
    return () => {
      mounted.current = false;
      serial.current++;
      readSerial.current++;
      readRequest.current?.abort();
      actionRequest.current?.abort();
      resume.current = null;
      clearInterval(polling);
      if (verifying.current) WebAuthnAbortService.cancelCeremony();
      if (challenge.current) void api('cancel', { challengeId: challenge.current }).catch(() => {});
    };
  }, [currentId]);
  useEffect(() => {
    onBusyChange?.(busy !== null || ownsResume);
    return () => onBusyChange?.(false);
  }, [busy, ownsResume, onBusyChange]);
  useEffect(() => {
    if (!busy && !ownsResume) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy, ownsResume]);

  function adopt(next: MaintenanceAdminStatus) {
    const captured = capturedMaintenanceEpoch();
    if (next.available && next.phase === 'running' && captured && captured !== next.epoch)
      setReloadRequired(true);
    if (next.phase === 'running' || next.operationId !== resume.current?.operationId)
      resume.current = null;
    setStatus(next);
    setNow(Date.now());
  }

  async function response(path: string, signal: AbortSignal, body?: unknown) {
    verifyAccount();
    const result = await fetch(`/api/admin/maintenance${path}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal,
      headers: {
        'X-Spinel-Account': currentId,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
    verifyAccount();
    return result;
  }

  async function refresh(explicit = true) {
    if (locked.current) return;
    readRequest.current?.abort();
    const controller = new AbortController();
    readRequest.current = controller;
    const identity = ++readSerial.current;
    if (explicit) setLoading(true);
    try {
      const result = await response(
        '',
        AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      );
      const data: MaintenanceControlResult =
        result.status === 404 ? { status: unavailable } : await result.json();
      if (!mounted.current || identity !== readSerial.current || controller.signal.aborted) return;
      if ((!result.ok && result.status !== 404) || typeof data.status?.available !== 'boolean')
        throw new Error('Maintenance status unavailable');
      adopt(data.status);
      if (explicit) setError('');
    } catch {
      if (mounted.current && identity === readSerial.current && !controller.signal.aborted)
        setError('Maintenance status could not be checked. Refresh before continuing.');
    } finally {
      if (mounted.current && identity === readSerial.current) setLoading(false);
    }
  }

  function openConfirmation(kind: Confirmation) {
    if (
      locked.current ||
      loading ||
      reloadRequired ||
      !status?.available ||
      status.phase !== 'running'
    )
      return;
    setError('');
    setMessage('');
    setVerifiedUntil(0);
    operation.current = crypto.randomUUID();
    setConfirmation(kind);
  }

  async function verify() {
    if (locked.current || !confirmation) return;
    locked.current = true;
    verifying.current = true;
    const identity = ++serial.current;
    const controller = new AbortController();
    actionRequest.current = controller;
    setBusy('verify');
    setError('');
    const check = () => {
      if (!mounted.current || identity !== serial.current || controller.signal.aborted)
        throw new DOMException('Passkey verification ended.', 'AbortError');
      verifyAccount();
    };
    const timeout = setTimeout(() => {
      controller.abort();
      WebAuthnAbortService.cancelCeremony();
    }, 60_000);
    try {
      const options = await api<{
        options: PublicKeyCredentialRequestOptionsJSON;
        challengeId: string;
      }>('reauthentication/options', {}, check, {
        signal: controller.signal,
        accountId: currentId,
      });
      challenge.current = options.challengeId;
      const assertion = await authenticate({ optionsJSON: options.options });
      check();
      const proof = await api<{ verifiedUntil: number }>(
        'reauthentication/verify',
        { challengeId: options.challengeId, response: assertion },
        check,
        { signal: controller.signal, accountId: currentId },
      );
      check();
      setVerifiedUntil(proof.verifiedUntil);
      setNow(Date.now());
    } catch {
      if (mounted.current && identity === serial.current)
        setError('Passkey verification did not finish. Try again with your Operator passkey.');
    } finally {
      clearTimeout(timeout);
      if (identity === serial.current) {
        if (challenge.current)
          void api('cancel', { challengeId: challenge.current }).catch(() => {});
        challenge.current = null;
        verifying.current = false;
        actionRequest.current = null;
        locked.current = false;
        if (mounted.current) setBusy(null);
      }
    }
  }

  function cancelVerification() {
    serial.current++;
    actionRequest.current?.abort();
    if (verifying.current) WebAuthnAbortService.cancelCeremony();
    verifying.current = false;
    if (challenge.current) void api('cancel', { challengeId: challenge.current }).catch(() => {});
    challenge.current = null;
    locked.current = false;
    setBusy(null);
    setVerifiedUntil(0);
    setError('');
    setConfirmation(null);
  }

  async function submit(kind: Confirmation | 'resume') {
    if (locked.current || reloadRequired || !status?.available) return;
    if (kind === 'resume' && !canResume) return;
    if (kind !== 'resume' && verifiedUntil <= Date.now()) {
      setVerifiedUntil(0);
      setNow(Date.now());
      setError('Passkey verification expired. Verify again before continuing.');
      return;
    }
    if (kind === 'resume' && (!resume.current || resume.current.expiresAt <= Date.now())) {
      resume.current = null;
      setNow(Date.now());
      return;
    }
    if (kind === 'notice' && !validNotice) return;
    if (kind !== 'resume' && status.phase !== 'running') {
      setError('Maintenance changed while this dialog was open. Close it and refresh the status.');
      return;
    }
    const operationId = kind === 'resume' ? resume.current?.operationId : operation.current;
    if (!operationId) return;
    locked.current = true;
    const identity = ++serial.current;
    const controller = new AbortController();
    actionRequest.current = controller;
    readRequest.current?.abort();
    readSerial.current++;
    setBusy('submit');
    setError('');
    setMessage('');
    try {
      const body =
        kind === 'resume'
          ? { operationId, resumeToken: resume.current!.token }
          : kind === 'notice'
            ? {
                operationId,
                intentExpiresAt: verifiedUntil,
                id: operationId,
                startsAt,
                timeZone: timeZone.trim(),
                durationMinutes,
              }
            : kind === 'cancel-notice'
              ? { operationId, intentExpiresAt: verifiedUntil, noticeId: status.notice?.id }
              : { operationId, intentExpiresAt: verifiedUntil };
      const result = await response(
        `/${kind}`,
        AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]),
        body,
      );
      const data: MaintenanceControlResult = await result.json();
      if (!mounted.current || identity !== serial.current || controller.signal.aborted) return;
      if (!result.ok || typeof data.status?.available !== 'boolean')
        throw new Error('Maintenance request could not be confirmed');
      if (kind === 'pause' && data.resumeToken && data.status.authorityExpiresAt)
        resume.current = {
          operationId,
          token: data.resumeToken,
          expiresAt: data.status.authorityExpiresAt,
        };
      adopt(data.status);
      if (kind === 'resume') setReloadRequired(true);
      setConfirmation(null);
      setVerifiedUntil(0);
      operation.current = null;
      setMessage(
        kind === 'resume'
          ? 'Edits resumed. Older pending changes still need to be checked before syncing.'
          : kind === 'notice'
            ? 'Maintenance notice published. Edits stay enabled until you pause them.'
            : kind === 'cancel-notice'
              ? 'Maintenance notice cancelled. No pause or resume was requested.'
              : data.status.phase === 'paused'
                ? 'Edits paused. Accepted work has finished.'
                : 'Pause requested. Waiting for accepted work to finish.',
      );
      void refreshMaintenanceStatus();
    } catch {
      if (mounted.current && identity === serial.current && !controller.signal.aborted) {
        setConfirmation(null);
        setVerifiedUntil(0);
        setError('The request could not be confirmed. Refresh maintenance before continuing.');
      }
    } finally {
      if (identity === serial.current) {
        locked.current = false;
        actionRequest.current = null;
        if (mounted.current) setBusy(null);
      }
    }
  }

  const disabled =
    busy !== null || loading || reloadRequired || !status?.available || Boolean(error);
  const activeNotice = status?.notice && status.notice.state !== 'cancelled' ? status.notice : null;
  const actionLabel =
    confirmation === 'pause'
      ? 'Pause edits'
      : confirmation === 'notice'
        ? 'Publish notice'
        : 'Cancel notice';
  return (
    <section
      className="admin-health-card maintenance-controls sp-ui"
      aria-label="Workspace maintenance controls"
    >
      <div className="admin-section-heading">
        <h3>Maintenance</h3>
        <div className="maintenance-actions">
          {status?.available && (
            <Button
              primary
              ref={actionButton}
              disabled={
                reloadRequired
                  ? reloadDisabled || busy !== null
                  : disabled || (status.phase !== 'running' && !canResume)
              }
              onClick={() => {
                if (reloadRequired) location.reload();
                else if (status.phase === 'running') openConfirmation('pause');
                else void submit('resume');
              }}
            >
              {reloadRequired
                ? 'Reload Administration'
                : busy === 'submit' && !confirmation
                  ? 'Resuming…'
                  : status.phase === 'running'
                    ? 'Pause edits'
                    : 'Resume'}
            </Button>
          )}
          {status?.available && (
            <ActionMenu
              label="Maintenance actions"
              triggerRef={menu}
              actions={[
                {
                  label: activeNotice ? 'Replace maintenance notice…' : 'Schedule a notice…',
                  disabled: disabled || status.phase !== 'running',
                  onClick: () => openConfirmation('notice'),
                },
                ...(activeNotice
                  ? [
                      {
                        label: 'Cancel maintenance notice…',
                        disabled: disabled || status.phase !== 'running',
                        onClick: () => openConfirmation('cancel-notice'),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </div>
      </div>
      {loading && !status && <p role="status">Loading maintenance status…</p>}
      {status?.available && (
        <>
          <p className="admin-health-state" role="status">
            <ProfileIcon
              icon={
                status.phase === 'running'
                  ? 'lucide:circle-check'
                  : status.phase === 'draining' || status.phase === 'starting'
                    ? 'lucide:clock'
                    : 'lucide:pause'
              }
            />
            <strong>{phaseLabel(status.phase)}</strong>
          </p>
          <p className="sp-muted">
            {status.phase === 'running'
              ? 'Pause workspace changes before server maintenance.'
              : status.phase === 'draining'
                ? 'New changes are blocked while accepted work finishes.'
                : status.phase === 'starting'
                  ? 'The application is starting with edits still paused.'
                  : 'Changes remain paused until an authorized resume.'}
          </p>
          {reloadRequired && (
            <p role="status">
              Maintenance resumed. Reload Administration before making another maintenance change.
            </p>
          )}
          {ownsResume && (
            <p className="maintenance-resume-window">
              Keep this page open to resume before{' '}
              <time dateTime={new Date(resume.current!.expiresAt).toISOString()}>
                {new Date(resume.current!.expiresAt).toLocaleTimeString()}
              </time>
              .
            </p>
          )}
          {needsServerControl && (
            <p role="alert">
              {status.authorityExpiresAt && status.authorityExpiresAt <= now
                ? 'Resume permission expired.'
                : 'Resume permission is unavailable in this tab.'}{' '}
              Use the server recovery controls.
            </p>
          )}
          {status.lastFailure && (
            <p role="alert">
              Maintenance needs a server check. Edits remain paused; follow the recovery guide.
            </p>
          )}
          {activeNotice && (
            <div className="maintenance-notice">
              <strong>
                {activeNotice.state === 'scheduled'
                  ? 'Scheduled notice'
                  : activeNotice.state === 'missed'
                    ? 'Announced window passed'
                    : 'Announced window started'}
              </strong>
              <p>
                {maintenanceTime(activeNotice.startsAt, activeNotice.timeZone)} (
                {activeNotice.timeZone})
              </p>
              <p className="sp-muted">
                About {activeNotice.durationMinutes} minutes. Pausing remains a separate action.
              </p>
            </div>
          )}
        </>
      )}
      {status && !status.available && (
        <p className="sp-muted">
          Maintenance controls are unavailable for this server. Follow the recovery guide to set
          them up.
        </p>
      )}
      {!confirmation && error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="maintenance-footer">
        <Button disabled={busy !== null || loading} onClick={() => void refresh()}>
          Refresh maintenance
        </Button>
        <a href={guide} target="_blank" rel="noopener noreferrer">
          Open recovery guide
        </a>
      </div>
      {confirmation && (
        <Modal
          open
          title={
            confirmation === 'pause'
              ? 'Pause workspace edits?'
              : confirmation === 'notice'
                ? 'Schedule a maintenance notice'
                : 'Cancel maintenance notice?'
          }
          icon={confirmation === 'pause' ? 'warning' : 'info'}
          dismissDisabled={busy === 'submit'}
          onOpenChange={(open) => {
            if (!open) cancelVerification();
          }}
          finalFocus={() => (confirmation === 'pause' ? actionButton.current : menu.current)}
        >
          <div className="maintenance-confirmation">
            {confirmation === 'pause' ? (
              <>
                <p>Stop new changes and let accepted work finish before maintenance.</p>
                <p className="sp-muted">
                  Pending changes on other devices stay unconfirmed. This does not restore or
                  replace the workspace.
                </p>
              </>
            ) : confirmation === 'notice' ? (
              <>
                <p id="maintenance-notice-range">
                  Announce one maintenance window within the next 365 days. You will still choose
                  when to pause edits.
                </p>
                <div className="maintenance-notice-fields">
                  <label>
                    Date and time
                    <input
                      type="datetime-local"
                      aria-describedby="maintenance-notice-range"
                      value={localTime}
                      onChange={(event) => {
                        setLocalTime(event.target.value);
                        setOccurrence('');
                      }}
                      disabled={busy !== null}
                    />
                  </label>
                  <label>
                    Time zone
                    <input
                      value={timeZone}
                      onChange={(event) => {
                        setTimeZone(event.target.value);
                        setOccurrence('');
                      }}
                      placeholder="America/Los_Angeles"
                      maxLength={100}
                      disabled={busy !== null}
                    />
                  </label>
                  <label>
                    Estimated minutes
                    <input
                      type="number"
                      min={1}
                      max={1440}
                      step={1}
                      value={duration}
                      onChange={(event) => setDuration(event.target.value)}
                      disabled={busy !== null}
                    />
                  </label>
                  {instants.values.length > 1 && (
                    <label>
                      This time occurs twice
                      <select
                        value={occurrence}
                        onChange={(event) => setOccurrence(event.target.value)}
                        disabled={busy !== null}
                      >
                        <option value="">Choose an occurrence</option>
                        {instants.values.map((instant, index) => (
                          <option value={instant} key={instant}>
                            {index === 0 ? 'First' : 'Second'} occurrence ·{' '}
                            {maintenanceOffset(instant, timeZone.trim())}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {instants.error ? (
                    <p role="alert">{instants.error}</p>
                  ) : !instants.values.length ? (
                    <p role="alert">
                      This local time is skipped by a clock change. Choose another time.
                    </p>
                  ) : startsAt && startsAt <= now ? (
                    <p role="alert">Choose a future start time.</p>
                  ) : startsAt && startsAt > latestNoticeAt ? (
                    <p role="alert">Choose a start time within the next 365 days.</p>
                  ) : startsAt ? (
                    <p className="sp-muted">Your local time: {maintenanceTime(startsAt)}</p>
                  ) : null}
                </div>
              </>
            ) : (
              <p>Remove this maintenance announcement. This does not pause or resume edits.</p>
            )}
            {error && <p role="alert">{error}</p>}
            {busy === 'verify' ? (
              <p role="status">Follow your passkey manager to verify this Operator account.</p>
            ) : verifiedUntil > now ? (
              <p role="status">Passkey verified. Confirm the action below.</p>
            ) : (
              <p className="sp-muted">Verify your Operator passkey before continuing.</p>
            )}
            <div className="admin-dialog-actions">
              <Button disabled={busy === 'submit'} onClick={cancelVerification}>
                Cancel
              </Button>
              {verifiedUntil > now ? (
                <Button
                  primary
                  disabled={busy !== null || (confirmation === 'notice' && !validNotice)}
                  onClick={() => void submit(confirmation)}
                >
                  {busy === 'submit' ? 'Working…' : actionLabel}
                </Button>
              ) : (
                <Button primary disabled={busy !== null} onClick={() => void verify()}>
                  {busy === 'verify' ? 'Verifying…' : 'Verify with a passkey'}
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
