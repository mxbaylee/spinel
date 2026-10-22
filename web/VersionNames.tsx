import { useState } from 'react';
import { historyHref, historyRequest } from './historyApi.ts';

import type { HistoryVersion as Version } from '../src/shared/historyNavigation.ts';

/** Version naming and entry points to the isolated history browser. */
export function VersionNames({
  id,
  saved,
  spaceId,
}: {
  id: string;
  saved: boolean;
  spaceId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [canName, setCanName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const refresh = async () => {
    const data = await historyRequest<{ versions: Version[]; canName: boolean }>(
      id,
      '',
      'GET',
      undefined,
      spaceId,
    );
    setVersions(data.versions);
    setCanName(data.canName);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this version name.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="version-names">
      <button
        aria-expanded={open}
        disabled={busy}
        onClick={() => {
          setOpen(!open);
          setEditing(null);
          if (!open) void run(refresh);
        }}
      >
        Versions
      </button>
      {open && (
        <section aria-label="Version names">
          <h3>Versions</h3>
          <a href={historyHref(id, spaceId)} target="_blank" rel="noopener">
            Browse history
          </a>
          {error && <p role="alert">{error}</p>}
          <button disabled={busy} onClick={() => void run(refresh)}>
            Refresh versions
          </button>
          {canName && (
            <>
              <button
                disabled={busy || !saved}
                onClick={() => {
                  setEditing('current');
                  setName('');
                }}
              >
                Name this version
              </button>
              {!saved && <p>Wait for all changes to save before naming the current version.</p>}
            </>
          )}
          {editing && canName && (
            <form
              aria-label="Name version"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  if (editing === 'current') {
                    if (!saved) throw new Error('Wait for all changes to save first.');
                    await historyRequest(id, '', 'POST', { name }, spaceId);
                  } else
                    await historyRequest(
                      id,
                      `/${encodeURIComponent(editing)}`,
                      'PATCH',
                      { name },
                      spaceId,
                    );
                  setEditing(null);
                  await refresh();
                });
              }}
            >
              <label>
                Version name{' '}
                <input
                  autoFocus
                  required
                  maxLength={120}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  disabled={busy}
                />
              </label>
              <button
                type="submit"
                disabled={busy || !name.trim() || (editing === 'current' && !saved)}
              >
                Save version name
              </button>
              <button type="button" disabled={busy} onClick={() => setEditing(null)}>
                Cancel
              </button>
            </form>
          )}
          <ul>
            {versions.map((version) => (
              <li key={version.id}>
                <span>{version.name ?? 'Unnamed version'}</span>
                {Boolean(version.beforeRestore) && <strong> — Before restore</strong>}
                <a href={historyHref(id, spaceId, version.id)} target="_blank" rel="noopener">
                  Preview version
                </a>{' '}
                <time dateTime={new Date(version.capturedAt).toISOString()}>
                  {new Date(version.capturedAt).toLocaleString()}
                </time>
                {canName && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setEditing(version.id);
                        setName(version.name ?? '');
                      }}
                    >
                      {version.name ? 'Rename version' : 'Name version'}
                    </button>
                    {version.name && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await historyRequest(
                              id,
                              `/${encodeURIComponent(version.id)}`,
                              'PATCH',
                              {
                                name: null,
                              },
                              spaceId,
                            );
                            await refresh();
                          })
                        }
                      >
                        Remove name
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          {!busy && !versions.length && <p>No saved versions yet.</p>}
          <p>
            Named versions are kept until you remove their names or permanently delete the document.
          </p>
        </section>
      )}
    </div>
  );
}
