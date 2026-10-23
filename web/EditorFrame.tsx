import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Action } from '../src/ui/redesign/Controls.tsx';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { GemLogo } from '../src/ui/GemLogo.tsx';
import { ConnectionStatus } from './ConnectionStatus.tsx';
import type { CatalogConnectionDetails } from './ConnectionStatus.tsx';
import type { ConnectionState } from './connectionState.ts';
import './editorFrame.css';
import { shouldExitTheatre } from './theatre.ts';

const preferenceKey = 'spinel-theatre';
export function escapeMayExitTheatre(event: KeyboardEvent, editing: boolean) {
  const target = event.target;
  return shouldExitTheatre({
    key: event.key,
    prevented: event.defaultPrevented,
    composing: event.isComposing,
    editing,
    interactive:
      target instanceof Element &&
      Boolean(
        target.closest(
          'input, textarea, select, [contenteditable="true"], dialog, [role="dialog"], [role="menu"]',
        ),
      ),
    overlay: Boolean(document.querySelector('dialog[open], [role="dialog"], [role="menu"]')),
  });
}

const Chrome = createContext<{
  saveTarget: HTMLElement | null;
  toolsTarget: HTMLElement | null;
  actions: Action[];
  guest: boolean;
  editing: { current: boolean };
} | null>(null);
export const useEditorChrome = () => useContext(Chrome);

/** Chrome changes size, never the editor's parent/key or collaboration lifetime. */
export function EditorFrame({
  name,
  connection,
  catalog,
  access,
  guest = false,
  onBack,
  onRename,
  actions = [],
  children,
  contextLabel,
  backLabel = 'Back to files',
}: {
  name: string;
  connection: ConnectionState;
  catalog?: CatalogConnectionDetails | null;
  access?: string;
  guest?: boolean;
  onBack?: () => void;
  onRename?: (name: string) => Promise<void>;
  actions?: Action[];
  children: ReactNode;
  contextLabel?: string;
  backLabel?: string;
}) {
  const [theatre, setTheatre] = useState(() => {
    try {
      return localStorage.getItem(preferenceKey) === 'true';
    } catch {
      return false;
    }
  });
  const [saveTarget, setSaveTarget] = useState<HTMLSpanElement | null>(null);
  const [toolsTarget, setToolsTarget] = useState<HTMLDivElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editing = useRef(false);
  const frame = useRef<HTMLElement>(null);
  function choose(value: boolean) {
    setTheatre(value);
    try {
      localStorage.setItem(preferenceKey, String(value));
    } catch {
      /* Visit-only preference. */
    }
  }
  useEffect(() => {
    if (!theatre) return;
    let mayExit = false;
    const before = (event: KeyboardEvent) => {
      mayExit = escapeMayExitTheatre(event, editing.current);
    };
    const escape = (event: KeyboardEvent) => {
      if (mayExit && !event.defaultPrevented) {
        event.preventDefault();
        choose(false);
      }
    };
    window.addEventListener('keydown', before, true);
    window.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('keydown', before, true);
      window.removeEventListener('keydown', escape);
    };
  }, [theatre]);
  return (
    <Chrome.Provider value={{ saveTarget, toolsTarget, actions, guest, editing }}>
      <section
        ref={frame}
        className="editor-frame"
        data-theatre={theatre}
        aria-label="Document workspace"
      >
        <header className="editor-header sp-ui">
          <div className="editor-identity">
            {onBack ? (
              <button className="sp-control sp-quiet" aria-label={backLabel} onClick={onBack}>
                <ProfileIcon
                  icon={backLabel === 'My files' ? 'lucide:layout-grid' : 'lucide:arrow-left'}
                />
              </button>
            ) : (
              <GemLogo size={24} />
            )}
            <div className="editor-name">
              {contextLabel && <span className="editor-context">{contextLabel}</span>}
              {renaming ? (
                <form
                  aria-label="Rename document"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!onRename || busy || !draft.trim()) return;
                    setBusy(true);
                    void onRename(draft.trim())
                      .then(() => {
                        setRenaming(false);
                        setError('');
                      })
                      .catch((cause) =>
                        setError(
                          cause instanceof Error
                            ? cause.message
                            : 'Could not rename this document.',
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  <input
                    aria-label="Document name"
                    autoFocus
                    maxLength={200}
                    value={draft}
                    disabled={busy}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        setRenaming(false);
                      }
                    }}
                  />
                  <button className="sp-control" disabled={busy || !draft.trim()}>
                    Save name
                  </button>
                </form>
              ) : (
                <h1 aria-label={name}>
                  {onRename ? (
                    <button
                      className="editor-rename"
                      aria-label={`Rename ${name}`}
                      onClick={() => {
                        setDraft(name);
                        setRenaming(true);
                      }}
                    >
                      {name}
                      <ProfileIcon icon="lucide:pencil" size={16} />
                    </button>
                  ) : (
                    name
                  )}
                </h1>
              )}
            </div>
          </div>
          <span className="save-slot" ref={setSaveTarget} />
          <ConnectionStatus state={connection} catalog={catalog} documentOpen />
          <div className="editor-tools" ref={setToolsTarget} />
          {access && <span className="editor-access">{access}</span>}
          <button
            className="sp-control sp-quiet editor-theatre-toggle"
            aria-label={theatre ? 'Exit theatre mode' : 'Enter theatre mode'}
            title={theatre ? 'Exit theatre mode' : 'Enter theatre mode'}
            onClick={() => choose(!theatre)}
          >
            <ProfileIcon icon={theatre ? 'lucide:minimize' : 'lucide:maximize'} />
          </button>
        </header>
        {error && <p role="alert">{error}</p>}
        <div className="editor-content">{children}</div>
      </section>
    </Chrome.Provider>
  );
}
