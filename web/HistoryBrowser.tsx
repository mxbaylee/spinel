import { useEffect, useRef, useState } from 'react';
import { ActionMenu, Button, Modal } from '../src/ui/redesign/Controls.tsx';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { spaceHref } from './spaceNavigation.ts';
import './history.css';
import {
  dayVersions,
  historyDay,
  historyMonth,
  historyVersionLabel,
  shiftHistoryMonth,
} from '../src/shared/historyNavigation.ts';
import type { HistoryVersion } from '../src/shared/historyNavigation.ts';
import { historyHref, historyRequest } from './historyApi.ts';
import { VersionPreview } from './VersionPreview.tsx';

/** History browsing stays in the isolated preview tab, outside the live editor. */
export function HistoryBrowser() {
  const query = new URLSearchParams(location.search);
  const id = query.get('item') ?? '',
    spaceId = query.get('space') ?? undefined,
    requested = query.get('version');
  const [versions, setVersions] = useState<HistoryVersion[]>([]);
  const [selected, setSelected] = useState<string | null>(requested);
  const [rendered, setRendered] = useState<string | null>(null);
  const [today, setToday] = useState(historyDay(Date.now()));
  const [day, setDay] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [mode, setMode] = useState<'today' | 'calendar'>('today');
  const [loaded, setLoaded] = useState(false),
    [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [error, setError] = useState('');
  const [canName, setCanName] = useState(false);
  const [naming, setNaming] = useState<HistoryVersion | 'current' | null>(null);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState('');
  const [savingName, setSavingName] = useState(false);
  const mutation = useRef<AbortController | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [controlsTarget, setControlsTarget] = useState<HTMLDivElement | null>(null);
  const liveHref = spaceId ? spaceHref(spaceId, { kind: 'page', id }) : `/?item=${encodeURIComponent(id)}`;
  useEffect(() => () => mutation.current?.abort(), [id, spaceId]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextDay = historyDay(Date.now());
      if (busy || loading || savingName || naming || nextDay === today) return;
      setToday(nextDay);
      if (mode === 'today') {
        setDay(nextDay);
        choose(dayVersions(versions, nextDay).at(-1));
      }
    }, 60000);
    return () => window.clearInterval(timer);
  }, [today, mode, versions, busy, loading, savingName, naming]);
  useEffect(() => {
    let disposed = false;
    const request = new AbortController();
    setLoading(true);
    setError('');
    void historyRequest<{ versions: HistoryVersion[]; canName: boolean }>(id, '', 'GET', undefined, spaceId, request.signal)
      .then((data) => {
        if (disposed) return;
        setVersions(data.versions);
        setCanName(data.canName);
        setLoaded(true);
        const clockDay = historyDay(Date.now());
        setToday(clockDay);
        // A requested checkpoint must never silently become a different restore target.
        const choice = selected
          ? data.versions.find((version) => version.id === selected)
          : [...data.versions].sort(
              (a, b) => b.capturedAt - a.capturedAt || a.id.localeCompare(b.id),
            )[0];
        if (selected && !choice) {
          setError('This saved version is no longer available. Choose another version.');
          setSelected(null);
          return;
        }
        if (choice) {
          const choiceDay = historyDay(choice.capturedAt);
          setSelected(choice.id);
          setDay(choiceDay);
          setMonth(choiceDay.slice(0, 7));
          setMode(choiceDay === clockDay ? 'today' : 'calendar');
        }
      })
      .catch((cause) => {
        if (!disposed) {
          setVersions([]);
          setCanName(false);
          setError(cause instanceof Error ? cause.message : 'Could not load history.');
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
      request.abort();
    };
  }, [id, spaceId, refresh]);
  useEffect(() => {
    const timer = window.setTimeout(() => setRendered(selected), 180);
    return () => window.clearTimeout(timer);
  }, [selected]);
  function choose(version?: HistoryVersion) {
    if (busy || loading || savingName) return;
    setError('');
    setSelected(version?.id ?? null);
    history.replaceState(null, '', historyHref(id, spaceId, version?.id));
  }
  const current = versions.find((version) => version.id === selected);
  const todays = dayVersions(versions, today),
    chosenDay = dayVersions(versions, day);
  const days = new Map<string, HistoryVersion[]>();
  for (const version of versions) {
    const key = historyDay(version.capturedAt);
    days.set(key, [...(days.get(key) ?? []), version]);
  }
  const months = [
    ...new Set(versions.map((version) => historyDay(version.capturedAt).slice(0, 7))),
  ].sort();
  const locked = busy || loading || savingName;
  function editName(version: HistoryVersion | 'current') {
    setName(version === 'current' ? '' : (version.name ?? ''));
    setNameError('');
    setNaming(version);
  }
  async function saveName(value: string | null, version: HistoryVersion | 'current') {
    if (!canName || mutation.current) return;
    const request = new AbortController();
    mutation.current = request;
    setSavingName(true);
    setNameError('');
    try {
      const result = await historyRequest<{ version: HistoryVersion }>(id,
        version === 'current' ? '' : '/' + encodeURIComponent(version.id),
        version === 'current' ? 'POST' : 'PATCH', { name: value }, spaceId, request.signal);
      if (request.signal.aborted) return;
      if (version === 'current') {
        setSelected(result.version.id);
        history.replaceState(null, '', historyHref(id, spaceId, result.version.id));
      }
      setNaming(null);
      setRefresh((value) => value + 1);
    } catch (cause) {
      if (!request.signal.aborted) setNameError(cause instanceof Error ? cause.message : 'Could not save this version name.');
    } finally {
      if (mutation.current === request) {
        mutation.current = null;
        if (!request.signal.aborted) setSavingName(false);
      }
    }
  }
  const selectionLabel = current ? `${historyDay(current.capturedAt)} ${historyVersionLabel(current)}` : 'No version selected';
  return (
    <section aria-label="Browse history" className="history-browser">
      <header className="sp-ui history-heading">
        <div><a className="sp-control" href={liveHref} aria-disabled={busy || undefined} onClick={(event) => { if (busy) event.preventDefault(); }}><ProfileIcon icon="lucide:arrow-left" size={18} />Return to document</a><h1>Document history</h1></div>
        <div className="history-actions">
          {canName && <Button disabled={locked} onClick={() => editName('current')}>Name current version…</Button>}
          <div ref={setControlsTarget} />
        </div>
      </header>
      <p className="history-selection" role="status">Selected {selectionLabel}</p>
      {error && <p role="alert">{error}</p>}
      {!loaded && loading && <p role="status">Loading history…</p>}
      {loaded && !versions.length && !error && <div className="history-empty"><h2>No versions yet</h2><p>Saved checkpoints will appear here. Return to your document to keep working.</p></div>}
      <div className="history-layout">
      <aside className="sp-ui history-chooser" data-open={chooserOpen}>
        <Button className="history-disclosure" aria-expanded={chooserOpen} aria-controls="history-choices" onClick={() => setChooserOpen(!chooserOpen)} disabled={busy}>
          <ProfileIcon icon={chooserOpen ? 'lucide:chevron-down' : 'lucide:chevron-right'} size={18} />Choose version · {current ? historyVersionLabel(current) : 'Saved checkpoints'}
        </Button>
        <div id="history-choices" className="history-choices">
        <p>Previewing leaves your live document unchanged. Times and calendar days use UTC.</p>
        <Button disabled={locked} onClick={() => setRefresh((value) => value + 1)}>Refresh history</Button>
        {nameError && !naming && <p role="alert">{nameError}</p>}
      <div role="group" aria-label="History view">
        <button
          aria-pressed={mode === 'today'}
          disabled={locked}
          onClick={() => {
            setMode('today');
            setDay(today);
            choose(todays.at(-1));
          }}
        >
          Today
        </button>
        <button
          aria-pressed={mode === 'calendar'}
          disabled={locked}
          onClick={() => {
            setMode('calendar');
            const prior = [...versions]
              .filter((version) => historyDay(version.capturedAt) < today)
              .sort((a, b) => b.capturedAt - a.capturedAt)[0];
            if (prior) {
              const priorDay = historyDay(prior.capturedAt);
              setDay(priorDay);
              setMonth(priorDay.slice(0, 7));
              choose(prior);
            } else choose();
          }}
        >
          Older days
        </button>
      </div>
      {mode === 'today' ? (
        <section aria-label="Today's timeline">
          <h2>Today — {today} UTC</h2>
          {todays.length ? (
            <>
              <label>
                Snapshot timeline
                <input
                  type="range"
                  min={0}
                  max={Math.max(1, todays.length - 1)}
                  step={1}
                  value={Math.max(
                    0,
                    todays.findIndex((version) => version.id === selected),
                  )}
                  disabled={locked || todays.length < 2}
                  list="history-ticks"
                  aria-valuetext={current ? historyVersionLabel(current) : 'Choose a snapshot'}
                  onChange={(event) => choose(todays[Number(event.target.value)])}
                />
              </label>
              <datalist id="history-ticks">
                {todays.map((version, index) => (
                  <option key={version.id} value={index} label={historyVersionLabel(version)} />
                ))}
              </datalist>
              <p>{todays.length} saved snapshots. Drag or use the arrow keys to preview.</p>
            </>
          ) : (
            loaded && <p>No saved snapshots today.</p>
          )}
        </section>
      ) : (
        <section aria-label="History calendar">
          <h2>Older days — UTC</h2>
          <div className="history-month-controls">
            <button
              disabled={locked || !months.length || month <= months[0]}
              onClick={() => setMonth(shiftHistoryMonth(month, -1))}
            >
              Previous month
            </button>
            <span>{month}</span>
            <button
              disabled={locked || month >= today.slice(0, 7)}
              onClick={() => setMonth(shiftHistoryMonth(month, 1))}
            >
              Next month
            </button>
          </div>
          <div className="history-calendar">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((name) => (
              <span key={name}>{name}</span>
            ))}
            {historyMonth(month).map((date, index) =>
              date ? (
                <button
                  key={date}
                  aria-label={`${date}${days.get(date)?.some((version) => version.name) ? ', named versions' : ''}`}
                  aria-pressed={date === day}
                  className={days.has(date) && date < today ? 'has-history' : undefined}
                  disabled={locked || date >= today || !days.has(date)}
                  onClick={() => {
                    setDay(date);
                    choose(dayVersions(versions, date).at(-1));
                  }}
                >
                  {Number(date.slice(-2))}
                  {days.get(date)?.some((version) => version.name) && <ProfileIcon icon="lucide:pin" size={10} />}
                </button>
              ) : (
                <span key={`blank-${index}`} />
              ),
            )}
          </div>
          <p>Highlighted days have saved snapshots; a pin marks named versions.</p>
          {!!chosenDay.length && day < today && (
            <label>
              Version on {day}
              <select
                value={selected ?? ''}
                disabled={locked}
                onChange={(event) =>
                  choose(chosenDay.find((version) => version.id === event.target.value))
                }
              >
                {chosenDay.map((version) => (
                  <option key={version.id} value={version.id}>
                    {historyVersionLabel(version)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {loaded && !versions.some((version) => historyDay(version.capturedAt) < today) && (
            <p>No saved snapshots from earlier days.</p>
          )}
        </section>
      )}
      <ul className="history-checkpoints" aria-label="Retained checkpoints">
        {(mode === 'today' ? todays : chosenDay).map((version) => (
          <li key={version.id}>
            <button className="history-checkpoint" aria-pressed={selected === version.id} disabled={locked} onClick={() => choose(version)}>
              <strong>{version.name ?? 'Unnamed version'}</strong>
              <span>{new Date(version.capturedAt).toISOString().slice(11,19)} UTC</span>
              {Boolean(version.beforeRestore) && <span>Before restore</span>}
            </button>
            {canName && <ActionMenu label={`Version actions for ${historyVersionLabel(version)}`} actions={[
              { label: version.name ? 'Rename version…' : 'Name version…', disabled: locked, onClick: () => editName(version) },
              ...(version.name ? [{ label: 'Remove name', disabled: locked, onClick: () => void saveName(null, version) }] : []),
            ]} />}
          </li>
        ))}
      </ul>
      </div>
      </aside>
      <div className="history-preview-pane">
      {selected !== rendered && <p role="status">Loading selected snapshot…</p>}
      <div hidden={selected !== rendered || Boolean(error) || loading}>
        {rendered && !error && !loading && (
          <VersionPreview
            key={`${spaceId ?? ''}:${id}:${rendered}`}
            id={id}
            spaceId={spaceId}
            checkpoint={rendered}
            checkpointLabel={selectionLabel}
            controlsTarget={controlsTarget}
            canRestore={canName && selected === rendered}
            onBusyChange={setBusy}
          />
        )}
      </div>
      </div>
      </div>
      {naming && <Modal icon="history" title={naming === 'current' ? 'Name current version' : 'Name saved version'} open dismissDisabled={savingName} onOpenChange={(open) => { if (!open) setNaming(null); }}>
        <form className="history-name-form" onSubmit={(event) => { event.preventDefault(); if (name.trim()) void saveName(name.trim(), naming); }}>
          <p>{naming === 'current' ? 'Names the latest confirmed saved content. Unsaved edits in another tab are not included.' : `${historyDay(naming.capturedAt)} ${historyVersionLabel(naming)}`}</p>
          <label>Version name<input autoFocus required maxLength={120} value={name} disabled={savingName} onChange={(event) => setName(event.target.value)} /></label>
          {nameError && <p role="alert">{nameError}</p>}
          <div className="sp-actions"><Button disabled={savingName} onClick={() => setNaming(null)}>Cancel</Button><Button type="submit" primary disabled={savingName || !name.trim()}>{savingName ? 'Saving…' : 'Save version name'}</Button></div>
        </form>
      </Modal>}
    </section>
  );
}
