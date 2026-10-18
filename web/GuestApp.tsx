import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { guestItemId, documentPath } from './documentAccess.ts';
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
type Item = { id: string; kind: 'sheet' | 'doc'; name: string; access: 'viewer' | 'editor' };
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
  const [notice, setNotice] = useState('');
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
            if (location.pathname === `/share/${id}` && location.hash.slice(1) === token)
              history.replaceState(null, '', location.pathname);
          })().catch((error) => {
            exchange.current = null;
            throw error;
          });
        await exchange.current;
        const response = await fetch(documentPath(id), { signal: AbortSignal.timeout(5000) });
        requireResponse(response);
        const data = await response.json();
        if (!disposed) {
          setItem(data.item);
          setError('');
          setNotice('');
        }
      } catch (cause) {
        if (!disposed) {
          if (cause instanceof LinkFailure && cause.revoked) {
            ended = true;
            setItem(null);
            setError(cause.message);
            setNotice('');
          } else setNotice('Connection interrupted. Keep this tab open; retrying…');
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
  return (
    <main className="workspace guest-workspace">
      <p>Spinel · Shared document</p>
      {notice && <p role="status">{notice}</p>}
      {error ? (
        <p role="alert">{error}</p>
      ) : item ? (
        <>
          <h1>{item.name}</h1>
          <p>{item.access === 'editor' ? 'You are editing as a guest.' : 'View-only link.'}</p>
          <Suspense fallback={<p role="status">Opening document…</p>}>
            {item.kind === 'sheet' ? (
              <Sheet
                id={id}
                name={item.name}
                onDirty={(value) => {
                  dirty.current = value;
                }}
              />
            ) : (
              <Doc
                id={id}
                name={item.name}
                onDirty={(value) => {
                  dirty.current = value;
                }}
              />
            )}
          </Suspense>
        </>
      ) : (
        <p role="status">Opening shared document…</p>
      )}
    </main>
  );
}
