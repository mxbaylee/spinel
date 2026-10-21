/** Local design fixture. Naming actions do not call a production API. */
import { useState } from 'react';
import type { HistoryVersion } from '../../shared/historyNavigation.ts';
import { ActionMenu, Button, Modal } from './Controls.tsx';
import './versionNamesReview.css';

export type VersionNamesReviewState =
  | 'ready'
  | 'loading'
  | 'load-error'
  | 'empty'
  | 'name-current'
  | 'name-older'
  | 'rename'
  | 'remove'
  | 'saving'
  | 'save-error'
  | 'removing'
  | 'remove-error';

const examples: HistoryVersion[] = [
  { id: 'latest', capturedAt: Date.UTC(2026, 9, 20, 17), name: null },
  { id: 'accountant', capturedAt: Date.UTC(2026, 9, 19, 16, 30), name: 'Sent to accountant' },
  { id: 'restore', capturedAt: Date.UTC(2026, 9, 18, 10), name: null, beforeRestore: true },
];

export function VersionNamesReview({
  saved = true,
  readOnly = false,
  state = 'ready',
  versions = examples,
  selectedId,
  showCurrentAction = true,
  compact = false,
  offline = false,
  onName,
  onSelect,
}: {
  saved?: boolean;
  readOnly?: boolean;
  state?: VersionNamesReviewState;
  versions?: HistoryVersion[];
  selectedId?: string;
  showCurrentAction?: boolean;
  compact?: boolean;
  offline?: boolean;
  onName?: (id: string, name: string | null) => void;
  onSelect?: (id: string) => void;
}) {
  const [localItems, setItems] = useState(state === 'empty' ? [] : versions);
  // Supplying onName makes names controlled so responsive copies share updates.
  const items = onName ? versions : localItems;
  const [loadState, setLoadState] = useState(
    state === 'loading' || state === 'load-error' ? state : 'ready',
  );
  const initialTarget =
    state === 'rename'
      ? 'accountant'
      : state === 'name-older'
        ? 'latest'
        : ['name-current', 'saving', 'save-error'].includes(state)
          ? 'current'
          : '';
  const [editing, setEditing] = useState(initialTarget);
  const [draft, setDraft] = useState(
    state === 'rename'
      ? 'Sent to accountant'
      : state === 'saving' || state === 'save-error'
        ? 'Ready for the trip'
        : '',
  );
  const [saveError, setSaveError] = useState(state === 'save-error');
  const [removing, setRemoving] = useState(
    ['remove', 'removing', 'remove-error'].includes(state) ? 'accountant' : '',
  );
  const [removeError, setRemoveError] = useState(state === 'remove-error');
  const [notice, setNotice] = useState('');
  const saving = state === 'saving';
  const deleting = state === 'removing';
  const waitingForSave = editing === 'current' && !saved;
  const showSaveError = saveError && !waitingForSave && !offline;
  const selected = items.find((item) => item.id === editing);
  const removingItem = items.find((item) => item.id === removing);
  const beginName = (id: string) => {
    setEditing(id);
    setDraft(items.find((item) => item.id === id)?.name ?? '');
    setSaveError(false);
  };
  const title =
    editing === 'current'
      ? 'Name this version'
      : selected?.name
        ? 'Rename version'
        : 'Name older version';
  return (
    <section className="sp-ui rd-version-names" aria-label="Version names">
      {(!compact || (showCurrentAction && !readOnly)) && (
        <div className="rd-version-names-heading">
          {!compact && <h2>Version names</h2>}
          {showCurrentAction && !readOnly && (
            <Button
              disabled={!saved || offline || loadState !== 'ready'}
              onClick={() => beginName('current')}
            >
              Name this version
            </Button>
          )}
        </div>
      )}
      {!compact && (
        <p className="sp-muted">
          Named versions are kept until you remove their names or permanently delete the file.
        </p>
      )}
      {offline && !readOnly && (
        <p role="status">
          Reconnect to change version names. Saved checkpoints remain available to preview.
        </p>
      )}
      {!saved && !readOnly && showCurrentAction && (
        <p role="status">
          Wait for changes to save before naming the current version. Older versions can still be
          named.
        </p>
      )}
      {loadState === 'loading' ? (
        <p role="status">Loading versions…</p>
      ) : loadState === 'load-error' ? (
        <div className="rd-version-feedback">
          <p role="alert">Could not load version names. Your document is unchanged.</p>
          <Button onClick={() => setLoadState('ready')}>Try again</Button>
        </div>
      ) : items.length ? (
        <ul className="rd-version-list">
          {items.map((item) => (
            <li key={item.id}>
              <div className="rd-version-identity">
                {onSelect ? (
                  <button
                    className="rd-version-preview"
                    aria-label={`${item.name ?? 'Unnamed version'} Preview version`}
                    title="Preview version"
                    aria-pressed={selectedId === item.id}
                    onClick={() => onSelect(item.id)}
                  >
                    <strong>{item.name ?? 'Unnamed version'}</strong>
                  </button>
                ) : (
                  <strong>{item.name ?? 'Unnamed version'}</strong>
                )}
                <time dateTime={new Date(item.capturedAt).toISOString()}>
                  {new Intl.DateTimeFormat('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZone: 'UTC',
                  }).format(item.capturedAt)}{' '}
                  · UTC
                </time>
                {item.beforeRestore && <span className="rd-version-marker">Before restore</span>}
              </div>
              {!readOnly && (
                <ActionMenu
                  label={`Actions for ${item.name ?? 'version from ' + new Date(item.capturedAt).toISOString()}`}
                  actions={[
                    {
                      label: item.name ? 'Rename version' : 'Name version',
                      disabled: offline,
                      onClick: () => beginName(item.id),
                    },
                    ...(item.name
                      ? [
                          {
                            label: 'Remove name',
                            destructive: true,
                            disabled: offline,
                            onClick: () => {
                              setRemoving(item.id);
                              setRemoveError(false);
                            },
                          },
                        ]
                      : []),
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>No saved versions yet. Your first saved change will appear here.</p>
      )}
      {notice && <p role="status">{notice}</p>}
      <Modal
        dismissDisabled={saving}
        title={title}
        description={
          editing === 'current'
            ? 'Give the current saved version a name you can find later.'
            : 'This names a saved checkpoint. Your live document stays unchanged.'
        }
        open={Boolean(editing) && !readOnly}
        onOpenChange={(open) => {
          if (!open && !saving) setEditing('');
        }}
      >
        <form
          className="rd-version-form"
          aria-busy={saving}
          onSubmit={(event) => {
            event.preventDefault();
            if (saving || offline || !draft.trim() || (editing === 'current' && !saved)) return;
            const name = draft.trim();
            if (!onName)
              setItems((current) =>
                editing === 'current'
                  ? [
                      { id: 'named-current', capturedAt: Date.UTC(2026, 9, 20, 18), name },
                      ...current.filter((item) => item.id !== 'named-current'),
                    ]
                  : current.map((item) => (item.id === editing ? { ...item, name } : item)),
              );
            onName?.(editing, name);
            setSaveError(false);
            setEditing('');
            setNotice(`Version named “${name}”.`);
          }}
        >
          <label>
            Version name
            <input
              autoFocus
              required
              maxLength={120}
              value={draft}
              disabled={saving}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          {waitingForSave && !offline && (
            <p role="status">Wait for changes to save. Your name stays here.</p>
          )}
          {offline && <p role="status">Reconnect to save this name. Your draft stays here.</p>}
          {showSaveError && (
            <p role="alert">Could not save this name. Your draft is still here. Try again.</p>
          )}
          <div className="sp-actions">
            <Button type="button" disabled={saving} onClick={() => setEditing('')}>
              Cancel
            </Button>
            <Button
              primary
              type="submit"
              disabled={saving || offline || !draft.trim() || (editing === 'current' && !saved)}
            >
              {saving ? 'Saving…' : showSaveError ? 'Try again' : 'Save name'}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        dismissDisabled={deleting}
        title="Remove this version’s name?"
        description="The version becomes unnamed and follows regular history retention. Its content is unchanged."
        open={Boolean(removing) && !readOnly}
        onOpenChange={(open) => {
          if (!open && !deleting) setRemoving('');
        }}
      >
        <div className="rd-version-form">
          <p>Remove “{removingItem?.name}”?</p>
          {offline && <p role="status">Reconnect before removing a version’s name.</p>}
          {removeError && (
            <p role="alert">
              Could not remove this name. It is still kept as a named version. Try again.
            </p>
          )}
          <div className="sp-actions">
            <Button disabled={deleting} onClick={() => setRemoving('')}>
              Keep name
            </Button>
            <Button
              className="sp-destructive"
              disabled={deleting || offline}
              onClick={() => {
                if (!onName)
                  setItems((current) =>
                    current.map((item) => (item.id === removing ? { ...item, name: null } : item)),
                  );
                onName?.(removing, null);
                setRemoving('');
                setRemoveError(false);
                setNotice('Name removed. This version now follows regular history retention.');
              }}
            >
              {deleting ? 'Removing…' : 'Remove name'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
