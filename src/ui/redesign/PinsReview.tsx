/** Local pin fixtures for the design walkthrough. No server or storage writes. */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { EntityIcon } from '../EntityIcon.tsx';
import { ActionMenu, Button } from './Controls.tsx';
import './pinsReview.css';

export type ReviewPin = {
  id: string;
  name: string;
  kind: 'doc' | 'sheet' | 'space' | 'folder';
};
export type PinsReviewState = 'ready' | 'loading' | 'load-failed' | 'pending' | 'update-failed';
export const initialReviewPins: ReviewPin[] = [
  { id: 'fixture-Quarterly budget', name: 'Quarterly budget', kind: 'sheet' },
  { id: 'fixture-Autumn plans', name: 'Autumn plans', kind: 'space' },
];
type PinsModel = {
  items: ReviewPin[];
  state: PinsReviewState;
  notice: string;
  toggle: (item: ReviewPin) => void;
  move: (id: string, offset: number) => void;
  retry: () => void;
  reconcile: (catalog: ReviewPin[]) => void;
};
const PinsContext = createContext<PinsModel | null>(null);
export function useReviewPins() {
  const pins = useContext(PinsContext);
  if (!pins) throw new Error('Review pins require PinsReviewProvider.');
  return pins;
}

export function PinsReviewProvider({
  children,
  ...props
}: {
  children: ReactNode;
  initialItems?: ReviewPin[];
  initialState?: PinsReviewState;
  mutationResult?: 'success' | 'failure';
}) {
  const parent = useContext(PinsContext);
  return parent ? children : <LocalPins {...props}>{children}</LocalPins>;
}
function LocalPins({
  children,
  initialItems = initialReviewPins,
  initialState = 'ready',
  mutationResult = 'success',
}: {
  children: ReactNode;
  initialItems?: ReviewPin[];
  initialState?: PinsReviewState;
  mutationResult?: 'success' | 'failure';
}) {
  const [items, setItems] = useState(initialItems);
  const [state, setState] = useState(initialState);
  const [notice, setNotice] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queued = useRef<{ items: ReviewPin[]; message: string } | undefined>(undefined);
  const catalogRef = useRef<ReviewPin[] | undefined>(undefined);
  const busy = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const reconcile = useCallback((catalog: ReviewPin[]) => {
    catalogRef.current = catalog;
    setItems((current) => {
      const next = current.flatMap((pin) => {
        const file = catalog.find((item) => item.id === pin.id);
        return file ? [{ id: file.id, name: file.name, kind: file.kind }] : [];
      });
      return next.length === current.length &&
        next.every(
          (pin, index) => pin.name === current[index].name && pin.kind === current[index].kind,
        )
        ? current
        : next;
    });
  }, []);
  function update(next: ReviewPin[], message: string, fail = mutationResult === 'failure') {
    if (busy.current) return;
    busy.current = true;
    queued.current = { items: next, message };
    setState('pending');
    setNotice('');
    timer.current = setTimeout(() => {
      busy.current = false;
      if (fail) setState('update-failed');
      else {
        // A rename or trash action can finish while the pin update is pending.
        // Preserve its outcome, including when retrying an earlier failed update.
        const currentPins = catalogRef.current
          ? next.flatMap((pin) => {
              const file = catalogRef.current!.find((item) => item.id === pin.id);
              return file ? [file] : [];
            })
          : next;
        const changed =
          currentPins.length !== next.length ||
          currentPins.some((pin, index) => pin.name !== next[index].name);
        setItems(currentPins);
        setState('ready');
        setNotice(
          `${changed ? 'Pins updated to match your current files.' : message} In this preview only.`,
        );
        queued.current = undefined;
      }
    }, 250);
  }
  const model: PinsModel = {
    items,
    state,
    notice,
    reconcile,
    toggle(item) {
      if (state !== 'ready') return;
      const pinned = items.some((entry) => entry.id === item.id);
      update(
        pinned ? items.filter((entry) => entry.id !== item.id) : [...items, item],
        `${item.name} ${pinned ? 'unpinned' : 'pinned'}.`,
      );
    },
    move(id, offset) {
      if (state !== 'ready') return;
      const index = items.findIndex((item) => item.id === id);
      const target = index + offset;
      if (index < 0 || target < 0 || target >= items.length) return;
      const next = [...items];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      update(next, `${item.name} moved ${offset < 0 ? 'up' : 'down'}.`);
    },
    retry() {
      if (queued.current) update(queued.current.items, queued.current.message, false);
      else {
        setState('ready');
        setNotice('Pins refreshed. In this preview only.');
      }
    },
  };
  return <PinsContext.Provider value={model}>{children}</PinsContext.Provider>;
}

export function PinReviewButton({ item }: { item: ReviewPin }) {
  const pins = useReviewPins();
  const pinned = pins.items.some((entry) => entry.id === item.id);
  return (
    <Button
      disabled={pins.state !== 'ready'}
      aria-label={`${pinned ? 'Unpin' : 'Pin'} ${item.name}`}
      onClick={() => pins.toggle(item)}
    >
      {pinned ? 'Unpin' : 'Pin'}
    </Button>
  );
}

export function PinnedReview({
  compact = false,
  selected,
  onSelect,
  disabled = false,
}: {
  compact?: boolean;
  selected?: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
}) {
  const pins = useReviewPins();
  const unavailable = disabled || pins.state !== 'ready';
  const failed = pins.state === 'load-failed' || pins.state === 'update-failed';
  return (
    <section className={`rd-pins ${compact ? 'rd-pins-compact' : ''}`} aria-label="Pinned items">
      {!compact && <h2>Pinned</h2>}
      {pins.state === 'loading' && <p role="status">Loading pins…</p>}
      {pins.state === 'pending' && <p role="status">Updating pins…</p>}
      {failed && (
        <div role="alert">
          <p>
            {compact
              ? pins.state === 'load-failed'
                ? 'Pins unavailable.'
                : 'Update failed.'
              : pins.state === 'load-failed'
                ? 'Could not load pins.'
                : 'Could not update pins. Your previous pins are unchanged.'}
          </p>
          <Button
            disabled={disabled}
            onClick={pins.retry}
            aria-label={pins.state === 'load-failed' ? 'Refresh pins' : 'Retry update'}
            title={pins.state === 'load-failed' ? 'Refresh pins' : 'Retry update'}
          >
            {compact ? '↻' : pins.state === 'load-failed' ? 'Refresh pins' : 'Retry update'}
          </Button>
        </div>
      )}
      {pins.state === 'ready' && !pins.items.length && (
        <p>No pins yet.{!compact && ' Pin a file or folder from its menu.'}</p>
      )}
      {pins.state !== 'loading' && pins.state !== 'load-failed' && (
        <ol aria-label="Pin order">
          {pins.items.map((item, index) => (
            <li key={item.id} data-pin-id={item.id}>
              <button
                className={compact ? 'rd-rail-button' : 'rd-nav-item'}
                title={item.name}
                aria-label={item.name}
                aria-current={selected === item.id || selected === item.name ? 'page' : undefined}
                onClick={() => onSelect(item.id)}
              >
                {item.kind === 'folder' ? (
                  <span aria-hidden="true">▱</span>
                ) : (
                  <EntityIcon kind={item.kind} size={18} />
                )}
                <span
                  className={compact ? 'rd-nav-tooltip' : 'rd-pin-name'}
                  aria-hidden={compact || undefined}
                >
                  {item.name}
                </span>
              </button>
              {!compact && (
                <ActionMenu
                  label={`Pin actions for ${item.name}`}
                  actions={[
                    {
                      label: 'Move up',
                      disabled: unavailable || index === 0,
                      onClick: () => pins.move(item.id, -1),
                    },
                    {
                      label: 'Move down',
                      disabled: unavailable || index === pins.items.length - 1,
                      onClick: () => pins.move(item.id, 1),
                    },
                    { label: 'Unpin', disabled: unavailable, onClick: () => pins.toggle(item) },
                  ]}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      {!compact && (
        <p className="rd-pins-notice" role="status">
          {pins.notice}
        </p>
      )}
    </section>
  );
}
