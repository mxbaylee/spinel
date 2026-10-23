import { useEffect, useRef, useState } from 'react';
import type {
  DatabaseHealth,
  HealthJobName,
  ServerHealth as Health,
} from '../src/shared/health.ts';
import { Button } from '../src/ui/redesign/Controls.tsx';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { adminResponse, operatorDenied } from './adminRequest.ts';
import './diagnostics.css';

export function healthBytes(value: number | null) {
  if (value === null) return 'Unavailable';
  const magnitude = Math.abs(value);
  const scale =
    magnitude >= 1024 ** 3
      ? 1024 ** 3
      : magnitude >= 1024 ** 2
        ? 1024 ** 2
        : magnitude >= 1024
          ? 1024
          : 1;
  const unit =
    scale === 1024 ** 3 ? 'GiB' : scale === 1024 ** 2 ? 'MiB' : scale === 1024 ? 'KiB' : 'bytes';
  return `${(value / scale).toLocaleString(undefined, { maximumFractionDigits: scale === 1 ? 0 : 1 })} ${unit}`;
}
const date = (value: number | null) =>
  value === null ? 'None yet' : new Date(value).toLocaleString();
const jobs: Record<HealthJobName, string> = {
  'history-maintenance': 'History capture & pruning',
  'trash-expiry': 'Trash expiry',
  'collaboration-purge': 'Collaboration & restored-generation cleanup',
  'space-trash-expiry': 'Space trash expiry',
};
function DatabaseSize({ label, value }: { label: string; value: DatabaseHealth | null }) {
  return (
    <section className="health-detail">
      <h4>{label}</h4>
      {value ? (
        <>
          <dl className="health-facts">
            <div>
              <dt>Database file</dt>
              <dd>{healthBytes(value.databaseBytes)}</dd>
            </div>
            <div>
              <dt>Write-ahead log (WAL)</dt>
              <dd>{healthBytes(value.walBytes)}</dd>
            </div>
            <div>
              <dt>Combined physical size</dt>
              <dd>{healthBytes(value.databaseBytes + value.walBytes)}</dd>
            </div>
            <div>
              <dt>Physical growth</dt>
              <dd>
                {value.growthBytes > 0 ? '+' : ''}
                {healthBytes(value.growthBytes)}
              </dd>
            </div>
          </dl>
          <p className="sp-muted">
            Growth measured since {date(value.measuredSince)}; it can decrease after WAL cleanup.
          </p>
        </>
      ) : (
        <p>Size unavailable.</p>
      )}
    </section>
  );
}

/** Read-only measurements. Backups retain their existing status/controller. */
export function ServerHealth() {
  const [data, setData] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const mounted = useRef(false),
    request = useRef(0);
  const controller = useRef<AbortController | null>(null);
  async function refresh() {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const identity = ++request.current;
    const current = () => {
      if (!mounted.current || identity !== request.current || active.signal.aborted)
        throw new Error('Obsolete health request');
    };
    setLoading(true);
    setError('');
    setData(null);
    setDenied(false);
    try {
      const response = await adminResponse(
        'health',
        AbortSignal.any([active.signal, AbortSignal.timeout(10_000)]),
        current,
      );
      const result = (await response.json()) as Health;
      current();
      setData(result);
    } catch (cause) {
      if (mounted.current && identity === request.current && !active.signal.aborted) {
        setDenied(operatorDenied(cause));
        setError(
          operatorDenied(cause)
            ? 'Operator access is unavailable. Sign in again with your Operator account.'
            : 'Server health is unavailable. Refresh to try again.',
        );
      }
    } finally {
      if (mounted.current && identity === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const interval = setInterval(() => void refresh(), 60_000);
    return () => {
      mounted.current = false;
      request.current++;
      controller.current?.abort();
      clearInterval(interval);
    };
  }, []);
  const failures = data?.jobs.filter((job) => job.failedSince !== null) ?? [];
  const lowStagingSpace =
    !!data &&
    data.storage.freeBytes !== null &&
    data.storage.backupStagingBytes !== null &&
    data.storage.freeBytes < data.storage.backupStagingBytes;
  const nearUploadCeiling =
    !!data &&
    data.storage.logicalDatabaseBytes !== null &&
    data.storage.logicalDatabaseBytes >= data.storage.backupUploadLimitBytes * 0.8;
  const needsAttention =
    !!data &&
    (data.memory.aboveBudgetSince !== null ||
      failures.length > 0 ||
      lowStagingSpace ||
      nearUploadCeiling);
  return (
    <section className="admin-health-card server-health sp-ui" aria-label="Server health">
      <div className="admin-section-heading">
        <h3>Server health</h3>
        <Button disabled={loading} onClick={() => void refresh()}>
          Refresh server health
        </Button>
      </div>
      {loading && <p role="status">Loading server health…</p>}
      {error && <p role="alert">{error}</p>}
      {denied && <a href="/sign-in">Sign in again</a>}
      {data && (
        <>
          <p className="admin-health-state">
            <ProfileIcon icon={needsAttention ? 'lucide:triangle-alert' : 'lucide:circle-check'} />
            <strong>{needsAttention ? 'Needs attention' : 'No warning in this sample'}</strong>
          </p>
          {data.memory.aboveBudgetSince !== null && (
            <p role="alert">
              Host memory is above 80% of the {healthBytes(data.memory.hostBudgetBytes)} budget.
              First observed {date(data.memory.aboveBudgetSince)}.
            </p>
          )}
          {failures.map((job) => (
            <p role="alert" key={job.name}>
              {jobs[job.name]} has failed since {date(job.failedSince)}.
            </p>
          ))}
          <p className="sp-muted">
            Sampled {date(data.sampledAt)}. Process started {date(data.startedAt)}. Refreshes every
            minute.
          </p>
          <section className="health-detail">
            <h4>Memory & connections</h4>
            <dl className="health-facts">
              <div>
                <dt>Host memory used</dt>
                <dd>{healthBytes(data.memory.systemUsedBytes)}</dd>
              </div>
              <div>
                <dt>Host budget</dt>
                <dd>{healthBytes(data.memory.hostBudgetBytes)}</dd>
              </div>
              <div>
                <dt>Reported host capacity</dt>
                <dd>{healthBytes(data.memory.systemTotalBytes)}</dd>
              </div>
              <div>
                <dt>App process (RSS)</dt>
                <dd>{healthBytes(data.memory.processRssBytes)}</dd>
              </div>
              <div>
                <dt>Container memory used</dt>
                <dd>{healthBytes(data.memory.containerUsedBytes)}</dd>
              </div>
              <div>
                <dt>Container memory limit</dt>
                <dd>{healthBytes(data.memory.containerLimitBytes)}</dd>
              </div>
              <div>
                <dt>Live editor connections</dt>
                <dd>{data.editorConnections}</dd>
              </div>
            </dl>
            <p className="sp-muted">
              Host usage uses{' '}
              {data.memory.systemMeasure === 'available'
                ? 'available memory, excluding reclaimable cache'
                : 'free memory; reclaimable cache may count as used'}
              . Process and container values overlap with host usage; do not add them.
            </p>
          </section>
          <DatabaseSize label="Application & collaboration" value={data.application} />
          <p className="sp-muted">
            The shared application and collaboration database is counted once.
          </p>
          <DatabaseSize label="Diagnostics storage" value={data.diagnostics} />
          <section className="health-detail">
            <h4>Backup space</h4>
            <dl className="health-facts">
              <div>
                <dt>Free data-volume space</dt>
                <dd>{healthBytes(data.storage.freeBytes)}</dd>
              </div>
              <div>
                <dt>Backup staging requirement</dt>
                <dd>{healthBytes(data.storage.backupStagingBytes)}</dd>
              </div>
              <div>
                <dt>Logical application database</dt>
                <dd>{healthBytes(data.storage.logicalDatabaseBytes)}</dd>
              </div>
              <div>
                <dt>Backup upload ceiling</dt>
                <dd>{healthBytes(data.storage.backupUploadLimitBytes)}</dd>
              </div>
            </dl>
            <p className="sp-muted">
              Staging allows 2.1 times the logical database plus 256 MiB. The encrypted archive size
              depends on compression; database size alone does not establish whether an upload will
              fit.
            </p>
            {lowStagingSpace && (
              <p role="alert">Free space is below the backup staging requirement.</p>
            )}
            {nearUploadCeiling && (
              <p role="alert">
                The logical database is at least 80% of the upload ceiling. Check the encrypted
                archive size before relying on the next backup.
              </p>
            )}
          </section>
          <section className="health-detail">
            <h4>Maintenance jobs</h4>
            <ul className="health-jobs">
              {data.jobs.map((job) => (
                <li key={job.name}>
                  <strong>{jobs[job.name]}</strong>
                  <p>
                    {!job.configured
                      ? 'Not configured'
                      : job.running
                        ? 'Running'
                        : job.failedSince !== null
                          ? 'Failed'
                          : job.lastSuccess !== null
                            ? 'OK'
                            : 'Not run yet'}
                  </p>
                  {job.configured && (
                    <>
                      <p>Last attempt: {date(job.lastAttempt)}</p>
                      <p>Last success: {date(job.lastSuccess)}</p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
      <a
        href="https://github.com/mxbaylee/spinel/blob/main/docs/deployment.md"
        target="_blank"
        rel="noopener noreferrer"
      >
        Open server guide
      </a>
    </section>
  );
}
