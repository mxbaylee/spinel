import { useEffect, useRef, useState } from 'react';
import { Button } from '../src/ui/redesign/Controls.tsx';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import './administration.css';
interface Status {
  configured: boolean;
  lastGood: number | null;
  lastAttempt: number | null;
  error: string | null;
  running: boolean;
  overdue: boolean;
}
export function BackupStatus() {
  const [status, setStatus] = useState<Status | null>(null);
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
      const result = (await response.json()) as Status;
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
            : !status.lastGood
              ? 'No backups yet'
              : 'OK';
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
          <p className="admin-health-state">
            <ProfileIcon
              icon={
                label === 'OK'
                  ? 'lucide:circle-check'
                  : label === 'Running'
                    ? 'lucide:clock'
                    : 'lucide:triangle-alert'
              }
            />
            <strong>{label}</strong>
          </p>
          {!status.configured && (
            <p role="alert">
              Offsite backups are not configured. Follow the backup setup guide on the server.
            </p>
          )}
          {status.error && <p role="alert">{status.error}</p>}
          {status.overdue && <p role="alert">A successful offsite backup is overdue.</p>}
          {status.running && <p role="status">Backup in progress…</p>}
          <p>
            Last successful backup:{' '}
            {status.lastGood ? new Date(status.lastGood).toLocaleString() : 'None yet'}
          </p>
          <p>
            Last attempt:{' '}
            {status.lastAttempt ? new Date(status.lastAttempt).toLocaleString() : 'None yet'}
          </p>
          <p className="sp-muted">Backup verification results are not available here yet.</p>
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
