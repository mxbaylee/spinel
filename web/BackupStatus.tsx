import { useEffect, useRef, useState } from 'react';
import { Button } from '../src/ui/redesign/Controls.tsx';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import './administration.css';
export interface BackupCheckStatus {
  lastGood: number | null;
  lastAttempt: number | null;
  error: string | null;
  running: boolean;
  overdue: boolean;
  keyId: string | null;
}
export interface BackupStatusResponse {
  configured: boolean;
  destination: 'filesystem' | 'spaces' | null;
  offsite: boolean;
  keyId: string | null;
  lastGood: number | null;
  lastAttempt: number | null;
  error: string | null;
  running: boolean;
  overdue: boolean;
  verification: BackupCheckStatus;
}
const timestamp = (value: number | null) =>
  value === null ? 'None yet' : new Date(value).toLocaleString();

function StateLabel({ label }: { label: string }) {
  return (
    <p className="admin-health-state">
      <ProfileIcon
        icon={
          label === 'OK' || label === 'Verified'
            ? 'lucide:circle-check'
            : label === 'Running'
              ? 'lucide:clock'
              : label === 'Local backup saved'
                ? 'lucide:hard-drive'
                : 'lucide:triangle-alert'
        }
      />
      <strong>{label}</strong>
    </p>
  );
}

export function BackupStatus() {
  const [status, setStatus] = useState<BackupStatusResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const mounted = useRef(false);
  const generation = useRef(0);
  async function refresh() {
    const request = ++generation.current;
    setLoading(true);
    try {
      const response = await fetch('/api/admin/backups');
      if (!response.ok) throw new Error('Could not load backup status. Refresh to try again.');
      const result = (await response.json()) as BackupStatusResponse;
      if (mounted.current && request === generation.current) {
        setStatus(result);
        setError('');
      }
    } catch {
      if (mounted.current && request === generation.current)
        setError('Could not load backup status. Refresh to try again.');
    } finally {
      if (mounted.current && request === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => {
      mounted.current = false;
      generation.current++;
      clearInterval(timer);
    };
  }, []);
  const label = !status
    ? ''
    : !status.configured
      ? 'Not configured'
      : status.running
        ? 'Running'
        : status.error
          ? 'Failed'
          : status.overdue
            ? 'Overdue'
            : status.lastGood === null
              ? 'No backups yet'
              : status.destination === 'filesystem'
                ? 'Local backup saved'
                : status.offsite
                  ? 'OK'
                  : 'Offsite unverified';
  const verification = status?.verification;
  const verificationLabel = !status?.configured
    ? 'Not configured'
    : !verification
      ? 'Unavailable'
      : verification.running
        ? 'Running'
        : verification.error
          ? 'Failed'
          : verification.overdue
            ? 'Overdue'
            : verification.lastGood === null
              ? 'Not verified yet'
              : 'Verified';
  return (
    <section aria-label="Backups" className="admin-health-card sp-ui">
      <div className="admin-section-heading">
        <h3>Backups</h3>
        <Button disabled={loading} onClick={() => void refresh()}>
          Refresh backup status
        </Button>
      </div>
      {loading && <p role="status">Loading backup status…</p>}
      {error ? (
        <p role="alert">{error}</p>
      ) : status ? (
        <>
          <StateLabel label={label} />
          <p>
            Destination:{' '}
            {status.destination === 'filesystem'
              ? 'Local filesystem'
              : status.destination === 'spaces'
                ? 'DigitalOcean Spaces'
                : status.configured
                  ? 'Unavailable'
                  : 'Not configured'}
          </p>
          {!status.configured && (
            <p role="alert">
              Offsite backups are not configured. Follow the backup setup guide on the server.
            </p>
          )}
          {status.destination === 'filesystem' && (
            <p role="alert">
              This backup is stored locally. Keep an independent offsite copy to recover if the host
              is lost.
            </p>
          )}
          {status.configured && status.destination !== 'filesystem' && !status.offsite && (
            <p role="alert">Offsite protection has not been established for this configuration.</p>
          )}
          {status.error && <p role="alert">{status.error}</p>}
          {status.overdue && <p role="alert">A successful backup is overdue.</p>}
          {status.running && <p role="status">Backup in progress…</p>}
          <p>Last successful backup: {timestamp(status.lastGood)}</p>
          <p>Last backup attempt: {timestamp(status.lastAttempt)}</p>
          {status.keyId && <p>Encryption key: {status.keyId}</p>}
          <section aria-label="Restore verification" className="admin-backup-verification">
            <h4>Restore verification</h4>
            <StateLabel label={verificationLabel} />
            <p className="sp-muted">
              A weekly isolated restore checks the backup without replacing the live workspace.
            </p>
            {verification?.error && <p role="alert">{verification.error}</p>}
            {verification?.overdue && (
              <p role="alert">A successful restore verification is overdue.</p>
            )}
            {verification?.running && <p role="status">Checking recovery…</p>}
            <p>Last successful restore check: {timestamp(verification?.lastGood ?? null)}</p>
            <p>Last restore check attempt: {timestamp(verification?.lastAttempt ?? null)}</p>
            {verification?.keyId && <p>Verified encryption key: {verification.keyId}</p>}
          </section>
        </>
      ) : null}
      <a
        href="https://github.com/mxbaylee/spinel/blob/main/docs/backups.md"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open backup guide
      </a>
    </section>
  );
}
