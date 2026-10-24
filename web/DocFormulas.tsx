import { useEffect, useId, useRef, useState } from 'react';
import {
  completeFormula,
  moveFormulaBindings,
  quoteFormulaName,
  type FormulaReference,
  type FormulaCompletion,
  FORMULA_FORMATS,
  FORMULA_LIMITS,
  FORMULA_MESSAGES,
  FormulaSaveError,
  formulaDisplayRows,
  type DocFormula,
  type FormulaDefinition,
  type FormulaDisplay,
  type FormulaFormat,
  type FormulaState,
} from '@spinel/doc-formulas';
import { documentPath } from './documentAccess.ts';
import './docFormulas.css';
import { palettes } from '../src/ui/palette.ts';
import { requestFormula } from '../src/shared/formulaRequest.ts';
import { isUuid, observeOperation } from '@spinel/diagnostics';
import type { DiagnosticContext } from '@spinel/diagnostics';
import { useDiagnostics } from './useDiagnostics.tsx';
import type { DiagnosticOperation } from './diagnosticsAccount.ts';
import { observedFormulaParse } from './formulaDiagnostics.ts';

// Univer's document is paper even when the surrounding application uses dark mode.
export const formulaPaperColors = {
  background: palettes.light['sp-header']!,
  unavailableBackground: palettes.light['fill-neutral-soft-bg']!,
  border: palettes.light['sp-border']!,
  text: palettes.light['sp-text']!,
};

export async function formulaRequest<T>(
  id: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  spaceId?: string,
  runId?: string,
): Promise<T> {
  return requestFormula<T>(`${documentPath(id, spaceId)}/formulas/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: {
            'Content-Type': 'application/json',
            ...(isUuid(runId) ? { 'X-Spinel-Diagnostic-Run': runId } : {}),
          },
          body: JSON.stringify(body),
        }),
  });
}

export function FormulaResultView({
  result,
  definition,
}: {
  result: FormulaDisplay;
  definition: FormulaDefinition;
}) {
  if (!result.ok) return <p role="status">{FORMULA_MESSAGES[result.reason]}</p>;
  const rows = formulaDisplayRows(result, definition);
  if (result.kind === 'scalar')
    return <output className="formula-value">{rows[0]?.[0] || '(empty)'}</output>;
  return (
    <div
      className="formula-table-scroll"
      tabIndex={0}
      aria-label="Formula table, scroll to see all columns"
    >
      <table className="formula-table">
        <caption>Formula result</caption>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td key={column}>{cell || '\u00a0'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Source = { itemId: string; name: string };
type Sheet = { sheetId: string; name: string };

export function FormulaDialog({
  id,
  spaceId,
  initial,
  onSave,
  onClose,
}: {
  id: string;
  spaceId?: string;
  initial?: DocFormula;
  onSave: (definition: FormulaDefinition, signal: AbortSignal) => Promise<void>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const diagnostics = useDiagnostics();
  const diagnosticContext = (runId?: string): DiagnosticContext => ({
    component: 'formula',
    fileId: id,
    ...(spaceId ? { spaceId } : {}),
    ...(runId ? { runId } : {}),
  });
  const input = useRef<HTMLInputElement>(null);
  const [expression, setExpression] = useState(initial?.definition.expression ?? '=');
  const [format, setFormat] = useState<FormulaFormat>(initial?.definition.format ?? 'general');
  const [sources, setSources] = useState<Source[]>([]);
  const [source, setSource] = useState('');
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [sheet, setSheet] = useState('');
  const [range, setRange] = useState('A1');
  const [loadingSources, setLoadingSources] = useState(true);
  const [loadingSheets, setLoadingSheets] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retrySave, setRetrySave] = useState(false);
  const [preview, setPreview] = useState<{
    definition: FormulaDefinition;
    result: FormulaDisplay;
  } | null>(null);
  const active = useRef(true);
  const attempt = useRef(0);
  const operation = useRef<AbortController | null>(null);
  const [bindings, setBindings] = useState<FormulaReference[]>([]);
  const [cursor, setCursor] = useState(expression.length);
  const [suggestion, setSuggestion] = useState(0);
  const [focused, setFocused] = useState(false);
  const suggestionId = useId();
  const [chosen, setChosen] = useState<{
    start: number;
    itemId: string;
    sheetId?: string;
    documentName: string;
    sheetName?: string;
  } | null>(null);
  const completion = completeFormula(expression, cursor, sources, sheets, source);
  useEffect(() => {
    if (completion.source && completion.source.itemId !== source)
      setSource(completion.source.itemId);
  }, [completion.source?.itemId, source]);
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === 'hidden') {
        operation.current?.abort();
        setPreview(null);
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, []);
  useEffect(() => {
    active.current = true;
    attempt.current++;
    operation.current = null;
    setPreview(null);
    setBusy(false);
    setError('');
    setRetrySave(false);
    const modal = dialog.current;
    modal?.showModal();
    const abort = new AbortController();
    setSources([]);
    setSource('');
    setLoadingSources(true);
    void formulaRequest<{ sources: Source[] }>(id, 'sources', undefined, abort.signal, spaceId)
      .then((data) => {
        if (!abort.signal.aborted) setSources(data.sources);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError('Could not load source suggestions. You can still type a formula.');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadingSources(false);
      });
    return () => {
      active.current = false;
      attempt.current++;
      operation.current?.abort();
      abort.abort();
      modal?.close();
    };
  }, [id, spaceId]);
  useEffect(() => {
    setSheets([]);
    setSheet('');
    if (!source) return;
    const abort = new AbortController();
    setLoadingSheets(true);
    void formulaRequest<{ sheets: Sheet[] }>(
      id,
      `sources/${encodeURIComponent(source)}`,
      undefined,
      abort.signal,
      spaceId,
    )
      .then((data) => {
        if (!abort.signal.aborted) setSheets(data.sheets);
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError('Could not load worksheets. Try choosing the source again.');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadingSheets(false);
      });
    return () => abort.abort();
  }, [id, source, spaceId]);
  const update = (value: string) => {
    setBindings((current) => moveFormulaBindings(expression, value, current));
    setChosen((current) => {
      if (!current) return null;
      const prefix = `${quoteFormulaName(current.documentName)}.${current.sheetName ? `${quoteFormulaName(current.sheetName)}.` : ''}`;
      const moved = moveFormulaBindings(expression, value, [
        {
          start: current.start,
          end: current.start + prefix.length,
          itemId: current.itemId,
          sheetId: current.sheetId ?? '',
          range: 'A1',
        },
      ])[0];
      return moved ? { ...current, start: moved.start } : null;
    });
    setExpression(value);
    setError('');
    setRetrySave(false);
    setCursor(value.length);
    setSuggestion(0);
    setPreview(null);
  };
  function chosenBinding(observation?: DiagnosticOperation): FormulaReference | undefined {
    if (!chosen?.sheetId) return;
    try {
      const reference = observedFormulaParse(
        expression,
        observation?.sink,
        diagnosticContext(observation?.runId),
      ).find((item) => item.start === chosen.start);
      if (
        reference &&
        reference.documentName === chosen.documentName &&
        reference.sheetName === chosen.sheetName
      )
        return {
          start: reference.start,
          end: reference.end,
          itemId: chosen.itemId,
          sheetId: chosen.sheetId,
          range: reference.range,
        };
    } catch {
      /* An unfinished reference has no binding yet. */
    }
  }
  async function resolve(signal: AbortSignal, observation?: DiagnosticOperation) {
    // Formatting an existing object never changes its source identities. Its evaluator
    // still checks current access; losing a source must not prevent fixing presentation.
    if (initial && expression === initial.definition.expression && !bindings.length && !chosen)
      return { ...initial.definition, format };
    const pending = chosenBinding(observation);
    const explicit = pending
      ? [...bindings.filter((item) => item.start !== pending.start), pending]
      : bindings;
    return (
      await formulaRequest<{ definition: FormulaDefinition }>(
        id,
        'resolve',
        {
          expression,
          format,
          previous: initial?.definition,
          bindings: explicit,
        },
        signal,
        spaceId,
      )
    ).definition;
  }
  async function run(save: boolean) {
    // A second submit in the same event turn must not start another native save.
    if (operation.current || !active.current) return;
    const observation = diagnostics.begin();
    const runId = observation?.runId;
    const current = ++attempt.current;
    const controller = new AbortController();
    operation.current = controller;
    setPreview(null);
    setBusy(true);
    setError('');
    setRetrySave(false);
    try {
      const definition = await resolve(controller.signal, observation);
      if (!active.current || current !== attempt.current || controller.signal.aborted) return;
      if (save) {
        await onSave(definition, controller.signal);
        if (active.current && current === attempt.current && !controller.signal.aborted) onClose();
      } else {
        setPreview({ definition, result: { ok: false, reason: 'loading' } });
        const started = performance.now();
        let result: FormulaDisplay;
        try {
          result = await formulaRequest<FormulaDisplay>(
            id,
            'evaluate',
            { definition },
            controller.signal,
            spaceId,
            runId,
          );
          if (!active.current || current !== attempt.current || controller.signal.aborted) return;
          observeOperation(
            observation?.sink,
            diagnosticContext(runId),
            'formula-evaluate',
            result.ok ? 'success' : 'failure',
            Math.max(0, performance.now() - started),
          );
        } catch (cause) {
          if (!active.current || current !== attempt.current || controller.signal.aborted) return;
          observeOperation(
            observation?.sink,
            diagnosticContext(runId),
            'formula-evaluate',
            controller.signal.aborted ? 'cancelled' : 'failure',
            Math.max(0, performance.now() - started),
          );
          throw cause;
        }
        if (active.current && current === attempt.current && !controller.signal.aborted)
          setPreview({ definition, result });
      }
    } catch (cause) {
      if (active.current && current === attempt.current && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'Could not update the formula.');
        setRetrySave(save && cause instanceof FormulaSaveError && cause.retryable);
      }
    } finally {
      if (operation.current === controller) operation.current = null;
      if (active.current && current === attempt.current) setBusy(false);
    }
  }
  function addReference() {
    const book = sources.find((entry) => entry.itemId === source);
    const tab = sheets.find((entry) => entry.sheetId === sheet);
    if (!book || !tab) return;
    const reference = `${quoteFormulaName(book.name)}.${quoteFormulaName(tab.name)}.${range.toUpperCase()}`;
    const start = input.current?.selectionStart ?? expression.length;
    const end = input.current?.selectionEnd ?? start;
    update(expression.slice(0, start) + reference + expression.slice(end));
    setBindings((current) => [
      ...current,
      {
        start,
        end: start + reference.length,
        itemId: source,
        sheetId: sheet,
        range: range.toUpperCase(),
      },
    ]);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(start + reference.length, start + reference.length);
    });
  }
  function choose(option: FormulaCompletion) {
    const pending = chosenBinding();
    update(option.expression);
    if (pending && pending.start !== option.start)
      setBindings((current) => [
        ...current.filter((item) => item.start !== pending.start),
        pending,
      ]);
    setCursor(option.cursor);
    setSource(option.source.itemId);
    if (option.sheet) setSheet(option.sheet.sheetId);
    setChosen({
      start: option.start,
      itemId: option.source.itemId,
      sheetId: option.sheet?.sheetId,
      documentName: option.source.name,
      sheetName: option.sheet?.name,
    });
    if (option.range && option.sheet)
      setBindings((current) => [
        ...current.filter((item) => item.start !== option.start),
        {
          start: option.start,
          end: option.cursor,
          itemId: option.source.itemId,
          sheetId: option.sheet!.sheetId,
          range: option.range!,
        },
      ]);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(option.cursor, option.cursor);
    });
  }
  const showSuggestions = focused && completion.options.length > 0;
  return (
    <dialog
      ref={dialog}
      className="formula-dialog"
      aria-label={initial ? 'Edit formula' : 'Insert formula'}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2>{initial ? 'Edit formula' : 'Insert formula'}</h2>
      <p>A single value appears inline. A range or array becomes a table.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(true);
        }}
      >
        <div className="formula-input">
          <label>
            Formula
            <input
              ref={input}
              autoFocus
              autoComplete="off"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showSuggestions}
              aria-controls={suggestionId}
              aria-activedescendant={showSuggestions ? `${suggestionId}-${suggestion}` : undefined}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onSelect={(event) =>
                setCursor(event.currentTarget.selectionStart ?? expression.length)
              }
              onKeyDown={(event) => {
                if (!showSuggestions) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSuggestion(
                    (value) =>
                      (value + (event.key === 'ArrowDown' ? 1 : completion.options.length - 1)) %
                      completion.options.length,
                  );
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  choose(completion.options[Math.min(suggestion, completion.options.length - 1)]!);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setFocused(false);
                }
              }}
              spellCheck={false}
              required
              maxLength={FORMULA_LIMITS.expression}
              value={expression}
              onChange={(event) => update(event.target.value)}
              disabled={busy}
              aria-describedby="formula-syntax"
            />
          </label>
          <ul
            id={suggestionId}
            role="listbox"
            aria-label="Formula suggestions"
            className="formula-suggestions"
            hidden={!showSuggestions}
          >
            {completion.options.map((option, index) => (
              <li key={`${option.source.itemId}-${option.label}`} role="presentation">
                <button
                  type="button"
                  role="option"
                  id={`${suggestionId}-${index}`}
                  aria-selected={index === suggestion}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
        <p id="formula-syntax" className="formula-hint">
          Start with =. Try <code>=Budget.Summary.A1</code>,{' '}
          <code>=SUM(Budget.Summary.A1, Forecast.Summary.A2)</code>, or <code>={'{1,2;3,4}'}</code>.
        </p>
        <details className="formula-source-picker">
          <summary>Find a cell or range</summary>
          {loadingSources ? (
            <p role="status">Loading spreadsheets…</p>
          ) : (
            <>
              <label>
                Spreadsheet
                <select
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  disabled={busy}
                >
                  <option value="">Choose a spreadsheet</option>
                  {sources.map((entry) => (
                    <option key={entry.itemId} value={entry.itemId}>
                      {entry.name}
                      {sources.filter((item) => item.name === entry.name).length > 1
                        ? ` (${entry.itemId.slice(0, 8)})`
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
              {source && (
                <label>
                  Worksheet
                  <select
                    value={sheet}
                    onChange={(event) => setSheet(event.target.value)}
                    disabled={busy || loadingSheets}
                  >
                    <option value="">
                      {loadingSheets ? 'Loading worksheets…' : 'Choose a worksheet'}
                    </option>
                    {sheets.map((entry) => (
                      <option key={entry.sheetId} value={entry.sheetId}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Cell or range
                <input
                  value={range}
                  onChange={(event) => setRange(event.target.value)}
                  placeholder="A1:C30"
                  pattern="[A-Za-z]{1,3}[1-9][0-9]{0,5}(:[A-Za-z]{1,3}[1-9][0-9]{0,5})?"
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                onClick={addReference}
                disabled={
                  busy ||
                  !source ||
                  !sheet ||
                  !/^[A-Za-z]{1,3}[1-9]\d{0,5}(?::[A-Za-z]{1,3}[1-9]\d{0,5})?$/.test(range)
                }
              >
                Insert reference
              </button>
              {!sources.length && (
                <p>No spreadsheets available. You can use numbers and arrays directly.</p>
              )}
            </>
          )}
        </details>
        <label>
          Number format
          <select
            value={format}
            onChange={(event) => {
              setFormat(event.target.value as FormulaFormat);
              setPreview(null);
              setError('');
              setRetrySave(false);
            }}
            disabled={busy}
          >
            {FORMULA_FORMATS.map((value) => (
              <option key={value} value={value}>
                {value[0]!.toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <p className="formula-hint">
          Readers need access to every referenced spreadsheet. Results are calculated for each
          reader and are not saved in this Doc.
        </p>
        {error && <p role="alert">{error}</p>}
        {preview && (
          <section aria-label="Formula preview">
            <h3>Preview</h3>
            <FormulaResultView {...preview} />
          </section>
        )}
        <div className="formula-actions">
          <button
            type="button"
            disabled={busy || expression.length < 2}
            onClick={() => void run(false)}
          >
            Preview
          </button>
          <button className="primary" disabled={busy || expression.length < 2}>
            {busy
              ? 'Working…'
              : retrySave
                ? initial
                  ? 'Retry save'
                  : 'Retry insert'
                : initial
                  ? 'Save formula'
                  : 'Insert formula'}
          </button>
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function FormulaReadout({ states }: { states: FormulaState[] }) {
  if (!states.length) return null;
  return (
    <details className="doc-formulas">
      <summary>Formula results ({states.length})</summary>
      <ul>
        {states.map(({ formula, result }) => (
          <li key={formula.id}>
            <code>{formula.definition.expression}</code>
            <FormulaResultView definition={formula.definition} result={result} />
          </li>
        ))}
      </ul>
    </details>
  );
}
