import { maintenanceFetch as fetch } from './maintenanceFetch.ts';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../src/ui/redesign/Controls.tsx';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { BackupDownloads } from './BackupDownloads.tsx';
import type { BackupPolicy } from './BackupDownloads.tsx';
import {
  getMaintenanceStatus,
  refreshMaintenanceStatus,
  useMaintenanceStatus,
} from './maintenanceState.ts';
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
  policy?: BackupPolicy;
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

export function BackupStatus({ currentId }: { currentId?: string }) {
  const { status: maintenance } = useMaintenanceStatus();
  const paused = !!maintenance?.available && maintenance.phase !== 'running';
  const [status, setStatus] = useState<BackupStatusResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const mounted = useRef(false);
  const generation = useRef(0);
  const wasPaused = useRef(paused);
  async function refresh() {
    const request = ++generation.current;
    const current = getMaintenanceStatus();
    if (current?.available && current.phase !== 'running') {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch('/api/admin/backups', {
        cache: 'no-store',
        headers: currentId ? { 'X-Spinel-Account': currentId } : {},
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        if (response.status === 503 && failure?.code === 'maintenance') {
          // Keep the download iframe and any open confirmation mounted while
          // accepted work drains. The public status remains available here.
          await refreshMaintenanceStatus();
          return;
        }
        throw new Error('Could not load backup status. Refresh to try again.');
      }
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
  }, [currentId]);
  useEffect(() => {
    const resume = wasPaused.current && !paused;
    wasPaused.current = paused;
    if (resume) void refresh();
  }, [paused]);
  const label = !status
    ? ''
    : !status.configured
      ? 'Not configured'
      : status.running
        ? 'Running'
        : status.error
          ? 'Failed'
          : status.policy && !status.policy.automatic && !status.lastGood
            ? 'Automatic backups off'
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
              ? status.policy && !status.policy.automatic
                ? 'Not scheduled'
                : 'Not verified yet'
              : 'Verified';
  return (
    <section aria-label="Backups" className="admin-health-card sp-ui">
      <div className="admin-section-heading">
        <h3>Backups</h3>
        <Button disabled={loading || paused} onClick={() => void refresh()}>
          Refresh backup status
        </Button>
      </div>
      {paused && (
        <p role="status">
          Backup status is paused for maintenance. Existing status will refresh when the workspace
          resumes.
        </p>
      )}
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
                : status.policy && !status.policy.automatic && !status.error
                  ? 'Manual downloads only'
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
          {status.policy && (
            <section aria-label="Backup policy" className="admin-backup-policy">
              <h4>Backup policy</h4>
              <dl>
                <dt>Automatic backups</dt>
                <dd>{status.policy.automatic ? 'On' : 'Off'}</dd>
                {status.policy.automatic && (
                  <>
                    <dt>Daily schedule</dt>
                    <dd>{String(status.policy.backupHourUtc).padStart(2, '0')}:00 UTC</dd>
                    <dt>Saved recovery points</dt>
                    <dd>
                      {status.policy.retention.daily} daily, {status.policy.retention.weekly} weekly{' '}
                      and {status.policy.retention.monthly} monthly
                    </dd>
                  </>
                )}
                <dt>Workspace downloads</dt>
                <dd>{status.policy.manualDownload ? 'Allowed' : 'Off'}</dd>
              </dl>
              <p className="sp-muted">
                Your deployment controls these settings. Backup retention does not change document
                history or diagnostics expiry.
              </p>
            </section>
          )}
          {currentId && status.policy && (
            <BackupDownloads
              key={currentId}
              currentId={currentId}
              policy={status.policy}
              hasDestination={status.destination !== null}
            />
          )}
          <section aria-label="Restore verification" className="admin-backup-verification">
            <h4>Restore verification</h4>
            <StateLabel label={verificationLabel} />
            <p className="sp-muted">
              {status.policy && !status.policy.automatic
                ? 'Automatic restore checks are off. Follow the backup guide to verify a downloaded recovery copy.'
                : 'A weekly isolated restore checks the backup without replacing the live workspace.'}
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
        className="admin-backup-guide"
        href="https://github.com/mxbaylee/spinel/blob/main/docs/backups.md"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open backup guide
      </a>
    </section>
  );
}
