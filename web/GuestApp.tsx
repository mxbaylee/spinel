import { EditorFrame } from './EditorFrame.tsx';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { guestRevokedEvent } from './guestRevocation.ts';
import type { GuestEditorStop, GuestPendingBuffer } from './guestRevocation.ts';
import { guestItemId, documentPath } from './documentAccess.ts';
import { AccessState } from './AccessState.tsx';
import type { ConnectionState } from './connectionState.ts';
import { useBrowserOnline } from './useConnectionStatus.ts';
import { Space } from './Space.tsx';
const Sheet = lazy(() => import('./SheetEditor.tsx').then((m) => ({ default: m.SheetEditor })));
const Doc = lazy(() => import('./DocEditor.tsx').then((m) => ({ default: m.DocEditor })));

class LinkFailure extends Error {
  readonly revoked: boolean;
  readonly unsupported: boolean;
  constructor(revoked: boolean, message?: string, unsupported = false) {
    super(
      message ??
        (revoked
          ? 'This link no longer works.'
          : 'Connection interrupted. Keep this tab open; retrying…'),
    );
    this.revoked = revoked;
    this.unsupported = unsupported;
  }
}
const requireResponse = (response: Response) => {
  if (!response.ok) throw new LinkFailure([401, 403, 404].includes(response.status));
};
type Item = {
  id: string;
  kind: 'sheet' | 'doc' | 'space';
  name: string;
  access: 'viewer' | 'editor';
};
export function GuestApp() {
  useEffect(() => {
    // Hash navigation alone does not run beforeunload. A real reload does, so
    // reopening/replacing a link cannot silently discard an unfinished edit.
    const changed = () => location.reload();
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, []);
  const id = guestItemId()!;
  const [token] = useState(() => location.hash.slice(1));
  const exchange = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const terminal = useRef(false);
  const stopEditor = useRef<GuestEditorStop | null>(null);
  const retainedBuffer = useRef<GuestPendingBuffer | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const registerGuestEditor = (stop: GuestEditorStop | null) => {
    stopEditor.current = stop;
  };
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const retry = useRef<() => Promise<void>>(async () => {});
  const [reachability, setReachability] = useState<ConnectionState>('reconnecting');
  const [editorConnection, setEditorConnection] = useState<ConnectionState | null>(null);
  const browserOnline = useBrowserOnline();
  useEffect(() => {
    setReachability(browserOnline ? 'reconnecting' : 'offline');
  }, [browserOnline]);
  useEffect(() => {
    let disposed = false,
      checking = false,
      ended = false;
    const revoke = () => {
      if (disposed || ended) return;
      ended = true;
      terminal.current = true;
      const pending = dirty.current;
      try {
        // Native roots, body portals and keyboard handlers are disposed before
        // removing the React shell. The retained data has no retrieval path.
        retainedBuffer.current = stopEditor.current?.(pending) ?? null;
      } finally {
        document.title = 'Spinel';
        flushSync(() => {
          setUnsaved(pending);
          setItem(null);
          setError('This link no longer works.');
          setUnsupported(false);
        });
      }
    };
    const check = async () => {
      if (checking || ended) return;
      checking = true;
      try {
        if (!exchange.current)
          exchange.current = (async () => {
            if (!token) return;
            if (!navigator.locks)
              throw new LinkFailure(
                true,
                'Open this link in a current browser that supports Web Locks.',
                true,
              );
            // Separate tabs share cookies. Serialize their exchange before either opens a socket.
            await navigator.locks.request(`spinel-guest:${id}`, async () => {
              const response = await fetch(`${documentPath(id)}/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token }),
                signal: AbortSignal.timeout(5000),
              });
              requireResponse(response);
            });
            // A slow earlier exchange must not erase a newer link's fragment.
            if (guestItemId() === id && location.hash.slice(1) === token)
              history.replaceState(null, '', `/share/${id}` + location.search);
          })().catch((error) => {
            exchange.current = null;
            throw error;
          });
        await exchange.current;
        const response = await fetch(documentPath(id), {
          cache: 'no-store',
          signal: AbortSignal.timeout(2500),
        });
        requireResponse(response);
        const data = await response.json();
        if (!disposed && !ended) {
          setItem(data.item);
          setError('');
          setReachability('online');
        }
      } catch (cause) {
        if (!disposed) {
          if (cause instanceof LinkFailure && cause.revoked) {
            if (cause.unsupported) {
              ended = true;
              setItem(null);
              setError(cause.message);
              setUnsupported(true);
            } else revoke();
          } else setReachability('offline');
        }
      } finally {
        checking = false;
      }
    };
    retry.current = check;
    window.addEventListener(guestRevokedEvent, revoke);
    void check();
    const interval = setInterval(() => {
      void check();
    }, 1000);
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      disposed = true;
      retry.current = async () => {};
      clearInterval(interval);
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener(guestRevokedEvent, revoke);
    };
  }, [id, token]);
  useEffect(() => {
    // Only an authorized item supplies the live tab name. Space owns its child
    // titles; a failed link never retains the previous document's identity.
    if (!item || error) document.title = 'Spinel';
    else if (item.kind !== 'space') document.title = `${item.name} — Spinel`;
  }, [item, error]);
  if (item?.kind === 'space')
    return (
      <>
        <Space
          guest
          navigation={{
            allow() {
              if (
                dirty.current &&
                !window.confirm(
                  'Your changes have not been saved. Leave and discard unsaved changes?',
                )
              )
                return false;
              dirty.current = false;
              return true;
            },
            dirty(value) {
              if (!terminal.current) dirty.current = value;
            },
          }}
          connection={
            !browserOnline || reachability === 'offline'
              ? 'offline'
              : (editorConnection ?? reachability)
          }
          onExit={() => {}}
          onConnectionState={setEditorConnection}
          renderEditor={({ spaceId, item: page, onDirty, onConnectionState, saveStatusTarget }) => (
            <Suspense fallback={<p role="status">Opening page…</p>}>
              {page.kind === 'doc' ? (
                <Doc
                  registerGuestEditor={registerGuestEditor}
                  saveStatusTarget={saveStatusTarget}
                  spaceId={spaceId}
                  id={page.id}
                  name={page.name}
                  onDirty={onDirty}
                  onConnectionState={onConnectionState}
                />
              ) : (
                <Sheet
                  registerGuestEditor={registerGuestEditor}
                  saveStatusTarget={saveStatusTarget}
                  spaceId={spaceId}
                  id={page.id}
                  name={page.name}
                  onDirty={onDirty}
                  onConnectionState={onConnectionState}
                />
              )}
            </Suspense>
          )}
        />
      </>
    );
  if (error || !item)
    return (
      <AccessState
        kind={
          error
            ? unsupported
              ? 'unsupported'
              : 'revoked'
            : !browserOnline || reachability === 'offline'
              ? 'offline'
              : 'loading'
        }
        onRetry={() => void retry.current()}
        unsaved={unsaved}
      />
    );
  return (
    <main className="workspace guest-workspace">
      <EditorFrame
        name={item.name}
        guest
        access={item.access === 'editor' ? 'Guest editor' : 'View only'}
        connection={
          !browserOnline || reachability === 'offline'
            ? 'offline'
            : (editorConnection ?? 'reconnecting')
        }
      >
        <Suspense fallback={<p role="status">Opening document…</p>}>
          {item.kind === 'sheet' ? (
            <Sheet
              registerGuestEditor={registerGuestEditor}
              saveStatusTarget={null}
              id={id}
              name={item.name}
              onConnectionState={setEditorConnection}
              onDirty={(value) => {
                if (!terminal.current) dirty.current = value;
              }}
            />
          ) : (
            <Doc
              registerGuestEditor={registerGuestEditor}
              saveStatusTarget={null}
              id={id}
              name={item.name}
              onConnectionState={setEditorConnection}
              onDirty={(value) => {
                if (!terminal.current) dirty.current = value;
              }}
            />
          )}
        </Suspense>
      </EditorFrame>
    </main>
  );
}
