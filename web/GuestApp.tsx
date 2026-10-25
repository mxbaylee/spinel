import { EditorFrame } from './EditorFrame.tsx';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { guestItemId, documentPath } from './documentAccess.ts';
import { GemLogo } from '../src/ui/GemLogo.tsx';
import { ConnectionStatus } from './ConnectionStatus.tsx';
import type { ConnectionState } from './connectionState.ts';
import { useBrowserOnline } from './useConnectionStatus.ts';
import { Space } from './Space.tsx';
const Sheet = lazy(() => import('./SheetEditor.tsx').then((m) => ({ default: m.SheetEditor })));
const Doc = lazy(() => import('./DocEditor.tsx').then((m) => ({ default: m.DocEditor })));

class LinkFailure extends Error {
  readonly revoked: boolean;
  constructor(revoked: boolean, message?: string) {
    super(
      message ??
        (revoked
          ? 'This link no longer works.'
          : 'Connection interrupted. Keep this tab open; retrying…'),
    );
    this.revoked = revoked;
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
  const [item, setItem] = useState<Item | null>(null);
  const [error, setError] = useState('');
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
        if (!disposed) {
          setItem(data.item);
          setError('');
          setReachability('online');
        }
      } catch (cause) {
        if (!disposed) {
          if (cause instanceof LinkFailure && cause.revoked) {
            ended = true;
            setItem((previous) => (previous?.kind === 'space' && dirty.current ? previous : null));
            setError(cause.message);
          } else setReachability('offline');
        }
      } finally {
        checking = false;
      }
    };
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
      clearInterval(interval);
      window.removeEventListener('beforeunload', warn);
    };
  }, [id, token]);
  if (item?.kind === 'space')
    return (
      <>
        {error && (
          <p role="alert">
            {error} {dirty.current && 'Copy unsaved changes before leaving.'}
          </p>
        )}
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
              dirty.current = value;
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
                  saveStatusTarget={saveStatusTarget}
                  spaceId={spaceId}
                  id={page.id}
                  name={page.name}
                  onDirty={onDirty}
                  onConnectionState={onConnectionState}
                />
              ) : (
                <Sheet
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
  return (
    <main className="workspace guest-workspace">
      {!item && (
        <div className="guest-brand">
          <GemLogo size={28} />
          <span>Spinel · Shared document</span>
          {!error && (
            <ConnectionStatus
              state={
                !browserOnline || reachability === 'offline'
                  ? 'offline'
                  : item
                    ? (editorConnection ?? 'reconnecting')
                    : reachability
              }
              documentOpen={Boolean(item)}
            />
          )}
        </div>
      )}
      {error ? (
        <p role="alert">{error}</p>
      ) : item ? (
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
                saveStatusTarget={null}
                id={id}
                name={item.name}
                onConnectionState={setEditorConnection}
                onDirty={(value) => {
                  dirty.current = value;
                }}
              />
            ) : (
              <Doc
                saveStatusTarget={null}
                id={id}
                name={item.name}
                onConnectionState={setEditorConnection}
                onDirty={(value) => {
                  dirty.current = value;
                }}
              />
            )}
          </Suspense>
        </EditorFrame>
      ) : (
        <p role="status">Opening shared document…</p>
      )}
    </main>
  );
}
