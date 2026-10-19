import { useEffect, useState } from 'react';
import {
  dayVersions,
  historyDay,
  historyMonth,
  historyVersionLabel,
  shiftHistoryMonth,
} from '../src/shared/historyNavigation.ts';
import type { HistoryVersion } from '../src/shared/historyNavigation.ts';
import { itemsRequest } from './itemsApi.ts';
import { VersionPreview } from './VersionPreview.tsx';

/** History browsing stays in the isolated preview tab, outside the live editor. */
export function HistoryBrowser() {
  const query = new URLSearchParams(location.search);
  const id = query.get('item') ?? '',
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
  useEffect(() => {
    const timer = window.setInterval(() => {
      const nextDay = historyDay(Date.now());
      if (busy || loading || nextDay === today) return;
      setToday(nextDay);
      if (mode === 'today') {
        setDay(nextDay);
        choose(dayVersions(versions, nextDay).at(-1));
      }
    }, 60000);
    return () => window.clearInterval(timer);
  }, [today, mode, versions, busy, loading]);
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError('');
    void itemsRequest<{ versions: HistoryVersion[] }>(`/${id}/history`)
      .then((data) => {
        if (disposed) return;
        setVersions(data.versions);
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
          setError(cause instanceof Error ? cause.message : 'Could not load history.');
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [id, refresh]);
  useEffect(() => {
    const timer = window.setTimeout(() => setRendered(selected), 180);
    return () => window.clearTimeout(timer);
  }, [selected]);
  function choose(version?: HistoryVersion) {
    if (busy || loading) return;
    setError('');
    setSelected(version?.id ?? null);
    const next = new URLSearchParams({ item: id });
    if (version) next.set('version', version.id);
    history.replaceState(null, '', `/preview?${next}`);
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
  return (
    <section aria-label="Browse history" className="history-browser">
      <h1>Document history</h1>
      <p>
        Times and calendar days use UTC, matching saved history. Previewing leaves the live document
        unchanged.
      </p>
      <button disabled={busy || loading} onClick={() => setRefresh((value) => value + 1)}>
        Refresh history
      </button>
      {error && <p role="alert">{error}</p>}
      {!loaded && loading && <p role="status">Loading history…</p>}
      <div role="group" aria-label="History view">
        <button
          aria-pressed={mode === 'today'}
          disabled={busy || loading}
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
          disabled={busy || loading}
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
                  disabled={busy || loading || todays.length < 2}
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
              disabled={busy || loading || !months.length || month <= months[0]}
              onClick={() => setMonth(shiftHistoryMonth(month, -1))}
            >
              Previous month
            </button>
            <span>{month}</span>
            <button
              disabled={busy || loading || month >= today.slice(0, 7)}
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
                  disabled={busy || loading || date >= today || !days.has(date)}
                  onClick={() => {
                    setDay(date);
                    choose(dayVersions(versions, date).at(-1));
                  }}
                >
                  {Number(date.slice(-2))}
                  {days.get(date)?.some((version) => version.name) ? ' 📌' : ''}
                </button>
              ) : (
                <span key={`blank-${index}`} />
              ),
            )}
          </div>
          <p>Highlighted days have saved snapshots; 📌 marks named versions.</p>
          {!!chosenDay.length && day < today && (
            <label>
              Version on {day}
              <select
                value={selected ?? ''}
                disabled={busy || loading}
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
      {current && (
        <p role="status">
          Selected {historyDay(current.capturedAt)} {historyVersionLabel(current)}
        </p>
      )}
      {selected !== rendered && <p role="status">Loading selected snapshot…</p>}
      <div hidden={selected !== rendered || Boolean(error)}>
        {rendered && !error && (
          <VersionPreview key={rendered} id={id} checkpoint={rendered} onBusyChange={setBusy} />
        )}
      </div>
    </section>
  );
}
