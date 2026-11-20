import type { MouseEvent } from 'react';
import './SyncStatus.css';

/**
 * Waiting and syncing depend on the connection, not on the file, so they never
 * coexist. Needing a choice can sit beside either.
 */
export type QueuedPhase = 'waiting' | 'syncing';
type Phase = QueuedPhase | 'attention';

export interface SyncStatusProps {
  /** Files with saved edits that send by themselves, and what is happening to them. */
  queued?: { phase: QueuedPhase; count: number };
  /** Files that need a choice. Each one gets a Recover action. */
  recover?: { itemId: string; name: string }[];
  /** Offered with waiting files while the connection is not confirmed. */
  onTryNow?: () => void;
  /** A connection check started by Try now is running. */
  checking?: boolean;
  /** Called before following a Recover link; return false to stay (unsaved work in view). */
  allowNavigation?: () => boolean;
}

const files = (count: number) => (count === 1 ? '1 file' : `${count} files`);

function Icon({ phase }: { phase: Phase }) {
  return (
    <svg
      className="sync-status-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {phase === 'syncing' ? (
        <path d="M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-1l2 3 M4 15l2 3a7 7 0 0 0 12-1" />
      ) : phase === 'attention' ? (
        <path d="M12 3 2.5 20h19L12 3z M12 10v4 M12 17h.01" />
      ) : (
        <path d="M12 21V8 M6 13l6-6 6 6 M5 3h14" />
      )}
    </svg>
  );
}

function Line({ phase, children }: { phase: Phase; children: string }) {
  const title =
    phase === 'waiting'
      ? 'Waiting to sync'
      : phase === 'syncing'
        ? 'Syncing now'
        : 'Needs attention';
  return (
    <p className="sync-status-line" data-phase={phase}>
      <strong className="sync-status-word">
        <Icon phase={phase} /> {title}
      </strong>{' '}
      {children}
    </p>
  );
}

/**
 * One status for saved edits that haven't reached the server, and the only banner
 * in its view. Every phase that applies gets a line; every action sits in one action line.
 */
export function SyncStatus({
  queued,
  recover = [],
  onTryNow,
  checking = false,
  allowNavigation,
}: SyncStatusProps) {
  const count = queued?.count ?? 0;
  if (!count && !recover.length) return null;
  const follow = (event: MouseEvent) => {
    if (allowNavigation && !allowNavigation()) event.preventDefault();
  };
  const tryNow = queued?.phase === 'waiting' && count > 0 && onTryNow;
  const needsChoice = recover.length > 0;
  return (
    <section
      className="sync-status"
      role={needsChoice ? 'alert' : 'status'}
      aria-label="Sync status"
    >
      {needsChoice && (
        <Line phase="attention">
          {`${files(recover.length)} can't send by itself. Choose what to do with ${recover.length === 1 ? 'it' : 'each'}.`}
        </Line>
      )}
      {count > 0 && queued?.phase === 'waiting' && (
        <Line phase="waiting">
          {`${count === 1 ? '1 file has' : `${count} files have`} changes saved on this device. They send as soon as you are back online.`}
        </Line>
      )}
      {count > 0 && queued?.phase === 'syncing' && (
        <Line phase="syncing">{`Sending changes from ${files(count)}. Nothing to do.`}</Line>
      )}
      {(needsChoice || tryNow) && (
        <div className="sync-status-actions">
          {recover.map((item) => (
            <a
              key={item.itemId}
              className="sync-status-button"
              href={`/?offlineRecovery=${encodeURIComponent(item.itemId)}`}
              onClick={follow}
            >
              Recover {item.name}
            </a>
          ))}
          {tryNow && (
            <button
              type="button"
              className="sync-status-button"
              onClick={onTryNow}
              disabled={checking}
              aria-busy={checking || undefined}
            >
              {checking ? 'Checking…' : 'Try now'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
