import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { GuestLinkEntry, GuestLinkExpiryDays } from '../src/shared/guestLinks.ts';
import { fileKindLabel } from '../src/shared/workspace.ts';
import { EntityIcon } from '../src/ui/EntityIcon.tsx';
import { ActionMenu, Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { clearDashboardNavigation } from './dashboardNavigation.ts';
import { spaceHref } from './spaceNavigation.ts';
import './guestLinks.css';

type Action = { kind: 'expiry' | 'off'; item: GuestLinkEntry };
const timestamp = (value: number) => new Date(value).toLocaleString();

/** This inventory never receives or reconstructs a guest capability. */
export function GuestLinks() {
  const [items, setItems] = useState<GuestLinkEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [expiryDays, setExpiryDays] = useState<GuestLinkExpiryDays>(7);
  const alive = useRef(false);
  const generation = useRef(0);
  const mutating = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  function current(request: number) {
    if (!alive.current || request !== generation.current)
      throw new Error('This guest-link view is no longer current.');
  }
  async function request<T>(path: string, method: string, body: unknown, version: number) {
    const response = await fetch(`/api/guest-links${path}`, {
      method,
      credentials: 'same-origin',
      signal: AbortSignal.any([lifetime.current!.signal, AbortSignal.timeout(15_000)]),
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    current(version);
    if (response.status === 401) {
      clearDashboardNavigation();
      location.assign('/sign-in');
    }
    if (response.status === 204) return undefined as T;
    const result = await response.json();
    current(version);
    if (!response.ok) throw new Error(result.error ?? 'Could not update guest links. Try again.');
    return result as T;
  }
  async function read(version: number) {
    const result = await request<{ items: GuestLinkEntry[] }>('', 'GET', undefined, version);
    current(version);
    setItems(result.items);
  }
  async function refresh() {
    if (mutating.current) return;
    const version = ++generation.current;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await read(version);
    } catch {
      if (alive.current && version === generation.current) {
        setItems(null);
        setError('Could not load guest links. Try again.');
      }
    } finally {
      if (alive.current && version === generation.current) setLoading(false);
    }
  }
  useLayoutEffect(() => {
    lifetime.current = new AbortController();
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      generation.current++;
      lifetime.current?.abort();
    };
  }, []);
  useEffect(() => {
    // Refresh at the next known deadline; only the server decides it has expired.
    // Cap long timers and avoid a busy loop when a device clock is ahead.
    if (!items || busy || loading) return;
    const deadlines = items
      .filter((item) => item.status === 'active' && item.expiresAt !== null)
      .map((item) => item.expiresAt!);
    const timer = deadlines.length
      ? setTimeout(
          () => void refresh(),
          Math.max(1000, Math.min(2_147_483_647, Math.min(...deadlines) - Date.now())),
        )
      : undefined;
    const focused = () => {
      if (!action) void refresh();
    };
    window.addEventListener('focus', focused);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', focused);
    };
  }, [items, busy, loading, action]);

  function open(kind: Action['kind'], item: GuestLinkEntry, from?: HTMLButtonElement | null) {
    if (mutating.current || loading) return;
    trigger.current = from ?? null;
    setError('');
    setNotice('');
    setExpiryDays(item.expiresAt === null ? null : 7);
    setAction({ kind, item });
  }
  async function save() {
    if (!action || mutating.current || loading) return;
    mutating.current = true;
    const version = ++generation.current;
    setBusy(true);
    setError('');
    setNotice('');
    const { item, kind } = action;
    try {
      const value = await request<GuestLinkEntry>(
        `/${encodeURIComponent(item.id)}`,
        kind === 'off' ? 'DELETE' : 'PATCH',
        {
          epoch: item.epoch,
          expectedExpiresAt: item.expiresAt,
          ...(kind === 'expiry' ? { expiryDays } : {}),
        },
        version,
      );
      current(version);
      setItems((previous) =>
        previous
          ? kind === 'off'
            ? previous.filter((entry) => entry.id !== item.id)
            : previous.map((entry) => (entry.id === item.id ? value : entry))
          : previous,
      );
      setAction(null);
      setNotice(
        kind === 'off' ? 'Guest link turned off.' : 'Expiry updated. The link is unchanged.',
      );
    } catch {
      if (!alive.current || version !== generation.current) return;
      // The server may have accepted a write whose response was lost. Re-read
      // before another action; do not claim the previous access is unchanged.
      setAction(null);
      try {
        await read(version);
        setError('Could not confirm the update. Review current guest links and try again.');
      } catch {
        if (alive.current && version === generation.current) {
          setItems(null);
          setError('Could not confirm the update. Reload guest links before trying again.');
        }
      }
    } finally {
      if (alive.current && version === generation.current) {
        mutating.current = false;
        setBusy(false);
      }
    }
  }
  const selected = action && items?.find((item) => item.id === action.item.id);
  const changed =
    action &&
    (!selected ||
      selected.epoch !== action.item.epoch ||
      selected.expiresAt !== action.item.expiresAt ||
      (action.kind === 'expiry' && selected.status !== 'active'));
  return (
    <section className="guest-links sp-ui" aria-label="Guest links" aria-busy={loading || busy}>
      <div className="guest-links-heading">
        <h2 ref={heading} tabIndex={-1}>
          Guest links
        </h2>
        <Button disabled={loading || busy || !!action} onClick={() => void refresh()}>
          Refresh
        </Button>
      </div>
      <p className="sp-muted">Links on files you own. Secret addresses are never listed.</p>
      <div className="guest-links-feedback">
        {loading && <p role="status">Loading guest links…</p>}
        {notice && <p role="status">{notice}</p>}
        {error && <p role="alert">{error}</p>}
      </div>
      {!loading && items === null && (
        <Button disabled={busy} onClick={() => void refresh()}>
          Reload guest links
        </Button>
      )}
      {items && !items.length && <p>No guest links. Create one from a file’s Share dialog.</p>}
      {!!items?.length && (
        <ul className="guest-links-list" aria-label="Your guest links">
          {items.map((item) => (
            <li key={item.id}>
              <EntityIcon kind={item.kind} />
              <div className="guest-links-details">
                <a href={item.kind === 'space' ? spaceHref(item.id) : `/?item=${item.id}`}>
                  {item.name}
                </a>
                <p>
                  {fileKindLabel[item.kind]} · {item.role === 'editor' ? 'Can edit' : 'View only'}
                  {item.status === 'expired' && ' · Expired'}
                </p>
                <p>
                  {item.enabledAt === null
                    ? 'Enabled date unknown'
                    : `Enabled ${timestamp(item.enabledAt)}`}
                  {' · '}
                  {item.expiresAt === null
                    ? 'Never expires'
                    : `${item.status === 'expired' ? 'Expired' : 'Expires'} ${timestamp(item.expiresAt)}`}
                </p>
                {item.kind === 'space' && (
                  <p>Every current and future page and folder in this Space.</p>
                )}
                {item.status === 'expired' && (
                  <p>To share again, open this file and create a new link.</p>
                )}
              </div>
              <ActionMenu
                label={`More actions for ${item.name}`}
                finalFocus={() => (action ? false : true)}
                actions={[
                  ...(item.status === 'active'
                    ? [
                        {
                          label: 'Change expiry…',
                          disabled: loading || busy,
                          onClick: (from?: HTMLButtonElement | null) => open('expiry', item, from),
                        },
                      ]
                    : []),
                  {
                    label: 'Turn off link',
                    destructive: true,
                    disabled: loading || busy,
                    onClick: (from) => open('off', item, from),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
      <Modal
        open={!!action}
        title={action?.kind === 'off' ? 'Turn off this guest link?' : 'Change link expiry'}
        icon="share"
        dismissDisabled={busy}
        finalFocus={() =>
          trigger.current?.isConnected ? trigger.current : (heading.current ?? true)
        }
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
      >
        {action && (
          <div className="guest-link-confirmation">
            <p className="guest-link-name">{action.item.name}</p>
            {action.kind === 'off' ? (
              <p>
                {action.item.kind === 'space'
                  ? 'Every guest using this link will lose access to the Space and all its pages.'
                  : 'Everyone using this link will lose access to this file.'}
              </p>
            ) : (
              <>
                <p>Changing expiry keeps the same link. The new duration starts when you save.</p>
                {action.item.kind === 'space' && (
                  <p>This applies to every page and folder in the Space.</p>
                )}
                <label>
                  Expire link after
                  <select
                    className="sp-control"
                    value={expiryDays === null ? 'never' : String(expiryDays)}
                    disabled={busy || loading || !!changed}
                    onChange={(event) =>
                      setExpiryDays(
                        event.target.value === 'never'
                          ? null
                          : (Number(event.target.value) as GuestLinkExpiryDays),
                      )
                    }
                  >
                    <option value="never">Never</option>
                    <option value="1">One day</option>
                    <option value="7">Seven days</option>
                    <option value="30">30 days</option>
                  </select>
                </label>
              </>
            )}
            {changed && (
              <p role="alert">
                This link changed. Close this dialog and review its current status.
              </p>
            )}
            {busy && <p role="status">Saving guest link…</p>}
            <div className="guest-link-actions">
              <Button disabled={busy} onClick={() => setAction(null)}>
                Cancel
              </Button>
              <Button primary disabled={busy || loading || !!changed} onClick={() => void save()}>
                {busy ? 'Saving…' : action.kind === 'off' ? 'Turn off link' : 'Save expiry'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
