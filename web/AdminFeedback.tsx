import { useEffect, useRef, useState } from 'react';
import type {
  FeedbackFlags,
  FeedbackPairReady,
  FeedbackPairPreparation,
  FeedbackScope,
} from '../src/shared/feedback.ts';
import { FEEDBACK_LIMITS } from '../src/shared/feedback.ts';
import { Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { AdminRequestError, adminResponse, operatorDenied } from './adminRequest.ts';
import './feedback.css';

export const diagnosticsClearedEvent = 'spinel:diagnostics-cleared';

/** A failed flag read remains unknown; only a successful response proves absence. */
export function useFeedbackFlags(revision: number) {
  const [flags, setFlags] = useState<FeedbackFlags | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const reload = () => setRefresh((value) => value + 1);
    window.addEventListener(diagnosticsClearedEvent, reload);
    window.addEventListener('focus', reload);
    return () => {
      window.removeEventListener(diagnosticsClearedEvent, reload);
      window.removeEventListener('focus', reload);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const current = () => {
      if (!active || controller.signal.aborted) throw new Error('Obsolete feedback flags.');
    };
    setLoading(true);
    setFlags(null);
    setError(false);
    void (async () => {
      try {
        const response = await adminResponse(
          'diagnostics/feedback',
          AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
          current,
        );
        const value = (await response.json()) as FeedbackFlags;
        current();
        if (
          !Array.isArray(value.actors) ||
          !value.actors.every((actor) => typeof actor === 'string')
        )
          throw new Error('Invalid feedback flags.');
        setFlags(value);
      } catch {
        if (active && !controller.signal.aborted) setError(true);
      } finally {
        if (active && !controller.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [revision, refresh]);
  return { flags, loading, error, reload: () => setRefresh((value) => value + 1) };
}

async function cancelPair(id: string) {
  try {
    await adminResponse(
      `diagnostics/feedback/${encodeURIComponent(id)}/cancel`,
      AbortSignal.timeout(10_000),
      () => {},
      {},
    );
  } catch {
    // Server expiry also bounds the lifetime if the tab or connection disappears.
  }
}

/** Two complete artifacts share one prepared source and one displayed receipt-time window. */
export function AdminFeedbackDownloads({
  actorId,
  accountName,
  initialScope,
  onClose,
  onRefreshFlags,
  finalFocus,
}: {
  actorId: string;
  accountName: string;
  initialScope: FeedbackScope;
  onClose(): void;
  onRefreshFlags(): void;
  finalFocus?: () => HTMLElement | boolean | null;
}) {
  const [pair, setPair] = useState<FeedbackPairReady | null>(null);
  const [busy, setBusy] = useState<'prepare' | FeedbackScope | null>(null);
  const [empty, setEmpty] = useState(false);
  const [expired, setExpired] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pairRef = useRef<FeedbackPairReady | null>(null);
  const action = useRef<AbortController | null>(null);
  const identity = useRef(0);
  const mounted = useRef(false);
  const objectUrls = useRef(
    new Map<FeedbackScope, { url: string; timer: ReturnType<typeof setTimeout> }>(),
  );
  const refreshFlags = useRef(onRefreshFlags);
  refreshFlags.current = onRefreshFlags;

  function begin(kind: 'prepare' | FeedbackScope) {
    if (action.current) return null;
    const controller = new AbortController();
    action.current = controller;
    const generation = ++identity.current;
    setBusy(kind);
    setError('');
    setNotice('');
    const current = () => {
      if (!mounted.current || identity.current !== generation || controller.signal.aborted)
        throw new Error('Obsolete feedback download.');
    };
    return { controller, generation, current };
  }
  function finish(generation: number) {
    if (!mounted.current || generation !== identity.current) return;
    action.current = null;
    setBusy(null);
  }
  function failed(cause: unknown, generation: number) {
    if (!mounted.current || generation !== identity.current) return;
    const lostPair = pairRef.current;
    if (lostPair) {
      // An interrupted transfer disposes both server artifacts. A missing response
      // cannot prove otherwise, so never offer another download from this pair.
      pairRef.current = null;
      setPair(null);
      void cancelPair(lostPair.id);
    }
    const expiredPair = cause instanceof AdminRequestError && cause.status === 410;
    setExpired(expiredPair);
    setDenied(operatorDenied(cause));
    setError(
      operatorDenied(cause)
        ? 'Operator access is unavailable. Sign in again with your Operator account.'
        : expiredPair
          ? 'These downloads expired or diagnostics were cleared. Prepare both again for a new shared time span.'
          : cause instanceof AdminRequestError && cause.status === 409
            ? 'Another diagnostics export is active. Finish or cancel it, then prepare these downloads again.'
            : lostPair
              ? 'This download could not be completed. Its snapshot is no longer available. Prepare both downloads again for a new shared time span. Files already sent to your browser are unchanged.'
              : 'Preparation could not be completed. Try preparing both downloads again.',
    );
    if (expiredPair) refreshFlags.current();
  }
  async function transfer(
    value: FeedbackPairReady,
    scope: FeedbackScope,
    job: NonNullable<ReturnType<typeof begin>>,
  ) {
    setBusy(scope);
    if (Date.now() >= value.expiresAt) throw new AdminRequestError(410);
    const response = await adminResponse(
      `diagnostics/feedback/${encodeURIComponent(value.id)}/download`,
      AbortSignal.any([job.controller.signal, AbortSignal.timeout(45_000)]),
      job.current,
      { scope },
    );
    if (!response.headers.get('Content-Type')?.startsWith('application/vnd.sqlite3'))
      throw new Error('Unexpected diagnostics response.');
    const length = Number(response.headers.get('Content-Length'));
    if (length > FEEDBACK_LIMITS.artifactBytes)
      throw new Error('Diagnostics artifact is too large.');
    const blob = await response.blob();
    job.current();
    if (blob.size > FEEDBACK_LIMITS.artifactBytes)
      throw new Error('Diagnostics artifact is too large.');
    // Retain at most one browser handoff per scope, each itself bounded by the server artifact limit.
    const previous = objectUrls.current.get(scope);
    if (previous) {
      clearTimeout(previous.timer);
      URL.revokeObjectURL(previous.url);
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `spinel-${scope}-metrics-${value.id}.sqlite`;
    document.body.append(link);
    link.click();
    link.remove();
    objectUrls.current.set(scope, {
      url,
      timer: setTimeout(() => {
        URL.revokeObjectURL(url);
        objectUrls.current.delete(scope);
      }, 60_000),
    });
    setNotice(
      `${scope === 'user' ? 'User' : 'System'} metrics sent to your browser. Check your downloads.`,
    );
  }
  async function prepare(scope?: FeedbackScope) {
    const job = begin('prepare');
    if (!job) return;
    const previous = pairRef.current;
    pairRef.current = null;
    setPair(null);
    setEmpty(false);
    setExpired(false);
    setDenied(false);
    try {
      if (previous) {
        await cancelPair(previous.id);
        job.current();
      }
      const response = await adminResponse(
        'diagnostics/feedback/prepare',
        AbortSignal.any([job.controller.signal, AbortSignal.timeout(45_000)]),
        job.current,
        { actorId },
      );
      const result = (await response.json()) as FeedbackPairPreparation;
      job.current();
      if (result.state === 'empty') {
        setEmpty(true);
        refreshFlags.current();
        return;
      }
      if (
        result.state !== 'ready' ||
        result.actorId !== actorId ||
        !Number.isFinite(result.expiresAt) ||
        !Number.isFinite(result.window.start) ||
        !Number.isFinite(result.window.end) ||
        result.window.start > result.window.end
      )
        throw new Error('Invalid diagnostics selection.');
      pairRef.current = result;
      setPair(result);
      if (scope) await transfer(result, scope, job);
    } catch (cause) {
      if (!job.controller.signal.aborted) failed(cause, job.generation);
    } finally {
      finish(job.generation);
    }
  }
  async function download(scope: FeedbackScope) {
    if (!pairRef.current || expired || denied) return;
    const job = begin(scope);
    if (!job) return;
    try {
      await transfer(pairRef.current, scope, job);
    } catch (cause) {
      if (!job.controller.signal.aborted) failed(cause, job.generation);
    } finally {
      finish(job.generation);
    }
  }
  function cancel() {
    action.current?.abort();
    action.current = null;
    identity.current++;
    setBusy(null);
    const value = pairRef.current;
    pairRef.current = null;
    setPair(null);
    if (value) void cancelPair(value.id);
    setNotice(
      'Preparation and pending download cancelled. Files already sent to your browser are unchanged.',
    );
  }
  useEffect(() => {
    mounted.current = true;
    void prepare(initialScope);
    const cleared = () => {
      cancel();
      setExpired(true);
      setNotice('Diagnostics were cleared. Prepare both downloads again to inspect new records.');
    };
    window.addEventListener(diagnosticsClearedEvent, cleared);
    return () => {
      mounted.current = false;
      identity.current++;
      action.current?.abort();
      action.current = null;
      if (pairRef.current) void cancelPair(pairRef.current.id);
      pairRef.current = null;
      for (const { url, timer } of objectUrls.current.values()) {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
      }
      objectUrls.current.clear();
      window.removeEventListener(diagnosticsClearedEvent, cleared);
    };
  }, []);
  useEffect(() => {
    if (!pair) return;
    const expire = () => {
      setExpired(true);
      action.current?.abort();
      action.current = null;
      identity.current++;
      setBusy(null);
      void cancelPair(pair.id);
    };
    const timer = setTimeout(expire, Math.max(0, pair.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [pair]);

  const disabled = busy !== null || !pair || expired || denied;
  return (
    <Modal
      title="Feedback diagnostics"
      icon="download"
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      finalFocus={finalFocus}
    >
      <div className="feedback-downloads" aria-busy={busy !== null}>
        <p>
          <strong>{accountName}</strong>
        </p>
        <p className="sp-muted">
          User metrics include all retained records attributed to this account. System metrics
          include everyone’s records in the same time span. Submitted feedback is included when
          present.
        </p>
        {busy === 'prepare' && <p role="status">Preparing both downloads from one snapshot…</p>}
        {(busy === 'user' || busy === 'system') && <p role="status">Downloading {busy} metrics…</p>}
        {pair && (
          <>
            <div className="feedback-window" aria-label="Shared time span">
              <strong>Shared time span · server receipt time</strong>
              <time dateTime={new Date(pair.window.start).toISOString()}>
                {new Date(pair.window.start).toLocaleString()}
              </time>
              <span>through</span>
              <time dateTime={new Date(pair.window.end).toISOString()}>
                {new Date(pair.window.end).toLocaleString()}
              </time>
              <span>
                {pair.counts.user.toLocaleString()} user records ·{' '}
                {pair.counts.system.toLocaleString()} system records
              </span>
            </div>
            {pair.context === 'feedback-only' && (
              <p role="status">
                Only feedback remains for this account. Associated metrics may have expired or were
                never collected; these downloads cannot recover them.
              </p>
            )}
            {!expired && (
              <p className="sp-muted">
                Available until {new Date(pair.expiresAt).toLocaleTimeString()}. Both downloads keep
                this snapshot even if new activity arrives.
              </p>
            )}
            <details>
              <summary>Collection limits</summary>
              <ul>
                {pair.limitations.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            </details>
          </>
        )}
        {empty && (
          <p role="status">
            No retained records remain for this account. There is no time span to export; system
            metrics are unavailable.
          </p>
        )}
        {expired && (
          <p role="status">
            This pair is no longer available. Preparing both again creates a new snapshot and may
            change the time span.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {denied && <a href="/sign-in">Sign in again</a>}
        <div className="feedback-download-buttons">
          <Button disabled={disabled} onClick={() => void download('user')}>
            Download user metrics
          </Button>
          <Button disabled={disabled} onClick={() => void download('system')}>
            Download system metrics
          </Button>
        </div>
        <div className="feedback-actions">
          {busy ? (
            <Button onClick={cancel}>Cancel download</Button>
          ) : (
            (!pair || expired) &&
            !denied && (
              <Button primary onClick={() => void prepare()}>
                Prepare both downloads
              </Button>
            )
          )}
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
