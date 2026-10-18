import { useEffect, useState } from 'react';
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
  useEffect(() => {
    let disposed = false;
    async function refresh() {
      try {
        const response = await fetch('/api/admin/backups');
        if (!response.ok) throw new Error('Could not load backup status. Refresh to try again.');
        const result = (await response.json()) as Status;
        if (!disposed) {
          setStatus(result);
          setError('');
        }
      } catch {
        if (!disposed) setError('Could not load backup status. Refresh to try again.');
      }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);
  return (
    <section aria-label="Backups">
      <h3>Backups</h3>
      {error ? (
        <p role="alert">{error}</p>
      ) : !status ? (
        <p>Loading backup status…</p>
      ) : (
        <>
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
        </>
      )}
    </section>
  );
}
