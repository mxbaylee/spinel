/** Local authoring fixture; completion and result rendering reuse production helpers. */
import { useId, useRef, useState } from 'react';
import {
  completeFormula,
  quoteFormulaName,
  FORMULA_FORMATS,
  FORMULA_LIMITS,
  type FormulaCompletion,
  type FormulaDefinition,
  type FormulaDisplay,
  type FormulaFormat,
} from '@spinel/doc-formulas';
import { FormulaResultView } from '../../../web/DocFormulas.tsx';
import { Button, Choice } from './Controls.tsx';
import './formulaReview.css';

export type FormulaReviewState =
  | 'ready'
  | 'source-loading'
  | 'source-empty'
  | 'source-error'
  | 'worksheet-loading'
  | 'worksheet-error'
  | 'scalar'
  | 'table'
  | 'thirty-rows'
  | 'empty'
  | 'calculating'
  | 'private-source'
  | 'missing-source'
  | 'invalid-formula'
  | 'too-large'
  | 'busy'
  | 'timeout'
  | 'unavailable'
  | 'offline'
  | 'saving'
  | 'save-error';
const sources = [
  { itemId: 'budget', name: 'Budget' },
  { itemId: 'forecast', name: 'Forecast' },
];
const sheets = [
  { sheetId: 'summary', name: 'Summary' },
  { sheetId: 'october', name: 'October' },
];
const scalar: FormulaDisplay = { ok: true, kind: 'scalar', value: 258.5 };
function sampleResult(state: FormulaReviewState): FormulaDisplay | null {
  if (state === 'table' || state === 'thirty-rows')
    return {
      ok: true,
      kind: 'table',
      rows:
        state === 'table'
          ? [
              ['Item', 'Actual', 'Budget'],
              ['Supplies', 120, 150],
              ['Travel', 320, 350],
            ]
          : Array.from({ length: 30 }, (_, row) => [`Item ${row + 1}`, row * 10, row * 12]),
    };
  if (state === 'empty') return { ok: true, kind: 'scalar', value: null };
  if (state === 'calculating') return { ok: false, reason: 'loading' };
  if (
    [
      'private-source',
      'missing-source',
      'invalid-formula',
      'too-large',
      'busy',
      'timeout',
      'unavailable',
    ].includes(state)
  )
    return { ok: false, reason: state as Extract<FormulaDisplay, { ok: false }>['reason'] };
  return state === 'scalar' ? scalar : null;
}

export function FormulaReview({
  state = 'ready',
  mode = 'insert',
  onApply,
  onCancel,
}: {
  state?: FormulaReviewState;
  mode?: 'insert' | 'edit';
  onApply?: (expression: string, format: FormulaFormat) => void;
  onCancel?: () => void;
}) {
  const [expression, setExpression] = useState(
    state === 'invalid-formula' ? '=SUM(' : '=Budget.Summary.A1',
  );
  const [format, setFormat] = useState<FormulaFormat>(
    state === 'table' || state === 'thirty-rows' ? 'general' : 'currency',
  );
  const [sourceState, setSourceState] = useState(state.startsWith('source-') ? state : 'ready');
  const [sheetState, setSheetState] = useState(state.startsWith('worksheet-') ? state : 'ready');
  const [source, setSource] = useState('budget');
  const [sheet, setSheet] = useState('summary');
  const [range, setRange] = useState('A1');
  const [result, setResult] = useState<FormulaDisplay | null>(() => sampleResult(state));
  const [page, setPage] = useState(0);
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState(expression.length);
  const [activeOption, setActiveOption] = useState(0);
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState(state === 'save-error');
  const input = useRef<HTMLInputElement>(null);
  const suggestionsId = useId();
  const hintId = useId();
  const availableSources = sourceState === 'ready' ? sources : [];
  const availableSheets = sheetState === 'ready' ? sheets : [];
  const completion = completeFormula(expression, cursor, availableSources, availableSheets, source);
  const showSuggestions = focused && completion.options.length > 0;
  const working = state === 'saving' || state === 'calculating';
  const offline = state === 'offline';
  const invalid = result && !result.ok && result.reason === 'invalid-formula';
  const definition: FormulaDefinition = { version: 1, expression, references: [], format };
  const update = (next: string) => {
    setExpression(next);
    setCursor(next.length);
    setActiveOption(0);
    setResult(null);
    setNotice('');
    setPage(0);
  };
  const choose = (option: FormulaCompletion) => {
    update(option.expression);
    setCursor(option.cursor);
    setSource(option.source.itemId);
    if (option.sheet) setSheet(option.sheet.sheetId);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(option.cursor, option.cursor);
    });
  };
  const preview = () => {
    setResult(state === 'thirty-rows' || state === 'table' ? sampleResult(state) : scalar);
    setPage(0);
    setNotice('Sample preview shown. This design preview does not calculate your expression.');
  };
  const rows = result?.ok && result.kind === 'table' ? result.rows : [];
  const shownResult =
    result?.ok && result.kind === 'table' && rows.length > 10
      ? { ...result, rows: rows.slice(page * 10, page * 10 + 10) }
      : result;
  return (
    <form
      className="sp-ui rd-formula-review"
      aria-label={mode === 'edit' ? 'Edit formula' : 'Insert formula'}
      aria-busy={working}
      onSubmit={(event) => {
        event.preventDefault();
        if (working || offline || invalid || expression.length < 2) return;
        onApply?.(expression, format);
        setSaveError(false);
        setNotice(`Formula ${mode === 'edit' ? 'saved' : 'inserted'} in this design preview only.`);
      }}
    >
      <p className="sp-muted">A single value appears inline. A range or array becomes a table.</p>
      <div className="rd-formula-input">
        <label>
          Formula
          <input
            ref={input}
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            required
            maxLength={FORMULA_LIMITS.expression}
            value={expression}
            disabled={working}
            aria-autocomplete="list"
            aria-expanded={showSuggestions}
            aria-controls={suggestionsId}
            aria-activedescendant={
              showSuggestions
                ? `${suggestionsId}-${Math.min(activeOption, completion.options.length - 1)}`
                : undefined
            }
            aria-describedby={hintId}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(event) => {
              update(event.target.value);
              setFocused(true);
            }}
            onSelect={(event) => setCursor(event.currentTarget.selectionStart ?? expression.length)}
            onKeyDown={(event) => {
              if (!showSuggestions) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveOption(
                  (current) =>
                    (current + (event.key === 'ArrowDown' ? 1 : completion.options.length - 1)) %
                    completion.options.length,
                );
              } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(completion.options[Math.min(activeOption, completion.options.length - 1)]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setFocused(false);
              }
            }}
          />
        </label>
        {showSuggestions && (
          <ul
            id={suggestionsId}
            role="listbox"
            aria-label="Formula suggestions"
            className="rd-formula-suggestions"
          >
            {completion.options.map((option, index) => (
              <li key={`${option.source.itemId}-${option.label}`} role="presentation">
                <button
                  type="button"
                  role="option"
                  id={`${suggestionsId}-${index}`}
                  aria-selected={index === activeOption}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <p id={hintId} className="sp-muted">
        Start with =. For example, <code>=Budget.Summary.A1</code> or <code>={'{1,2;3,4}'}</code>.
      </p>
      <details
        className="rd-formula-source"
        open={state.startsWith('source-') || state.startsWith('worksheet-') || undefined}
      >
        <summary>Find a cell or range</summary>
        {sourceState === 'source-loading' ? (
          <p role="status">Loading spreadsheets…</p>
        ) : (
          <div className="rd-formula-picker">
            {sourceState === 'source-error' ? (
              <div className="rd-formula-feedback">
                <p role="alert">Could not load source suggestions. You can still type a formula.</p>
                <Button type="button" onClick={() => setSourceState('ready')}>
                  Retry sources
                </Button>
              </div>
            ) : sourceState === 'source-empty' ? (
              <p>No spreadsheets available. You can use numbers and arrays directly.</p>
            ) : (
              <>
                <Choice
                  label="Spreadsheet"
                  value={source}
                  disabled={working}
                  options={sources.map((entry) => ({ value: entry.itemId, label: entry.name }))}
                  onChange={(next) => {
                    setSource(next);
                    setSheet('summary');
                    setSheetState('ready');
                  }}
                />
                {sheetState === 'worksheet-loading' ? (
                  <p role="status">Loading worksheets…</p>
                ) : sheetState === 'worksheet-error' ? (
                  <div className="rd-formula-feedback">
                    <p role="alert">Could not load worksheets. Your formula is unchanged.</p>
                    <Button type="button" onClick={() => setSheetState('ready')}>
                      Retry worksheets
                    </Button>
                  </div>
                ) : (
                  <Choice
                    label="Worksheet"
                    value={sheet}
                    disabled={working}
                    options={sheets.map((entry) => ({ value: entry.sheetId, label: entry.name }))}
                    onChange={setSheet}
                  />
                )}
                <label>
                  Cell or range
                  <input
                    value={range}
                    onChange={(event) => setRange(event.target.value)}
                    placeholder="A1:C30"
                    disabled={working}
                  />
                </label>
                <Button
                  type="button"
                  disabled={
                    working ||
                    sheetState !== 'ready' ||
                    !/^[A-Za-z]{1,3}[1-9]\d{0,5}(?::[A-Za-z]{1,3}[1-9]\d{0,5})?$/.test(range)
                  }
                  onClick={() => {
                    const reference = `${quoteFormulaName(sources.find((entry) => entry.itemId === source)!.name)}.${quoteFormulaName(sheets.find((entry) => entry.sheetId === sheet)!.name)}.${range.toUpperCase()}`;
                    update(`=${reference}`);
                    input.current?.focus();
                  }}
                >
                  Use this reference
                </Button>
                <p className="sp-muted">Using a reference replaces the expression above.</p>
              </>
            )}
          </div>
        )}
      </details>
      <Choice
        label="Number format"
        value={format}
        disabled={working}
        onChange={(next) => {
          setFormat(next as FormulaFormat);
          setResult(null);
        }}
        options={FORMULA_FORMATS.map((value) => ({
          value,
          label: value[0].toUpperCase() + value.slice(1),
        }))}
      />
      <p className="sp-muted">
        Readers need access to every source Sheet. Results are calculated for each reader and are
        not saved in this Doc.
      </p>
      {offline ? (
        <p role="status">
          Formula unavailable offline. Previous values stay hidden. Your expression is kept here.
        </p>
      ) : (
        shownResult && (
          <section className="rd-formula-result" aria-label="Sample formula preview">
            <h3>Sample preview · not calculated</h3>
            <FormulaResultView definition={definition} result={shownResult} />
            {rows.length > 10 && (
              <nav className="rd-formula-pagination" aria-label="Formula result pages">
                <Button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <span>
                  Rows {page * 10 + 1}–{Math.min((page + 1) * 10, rows.length)} of {rows.length}
                </span>
                <Button
                  type="button"
                  disabled={(page + 1) * 10 >= rows.length}
                  onClick={() => setPage(page + 1)}
                >
                  Next
                </Button>
              </nav>
            )}
            {result && !result.ok && ['busy', 'timeout', 'unavailable'].includes(result.reason) && (
              <Button type="button" onClick={preview}>
                Retry preview
              </Button>
            )}
          </section>
        )
      )}
      {saveError && (
        <p role="alert">
          Could not save this formula. Your expression and format are still here. Try again.
        </p>
      )}
      <div className="sp-actions">
        <Button
          type="button"
          disabled={working}
          onClick={() => {
            onCancel?.();
            setNotice('Changes canceled in this preview.');
          }}
        >
          Cancel
        </Button>
        <Button
          type="button"
          disabled={working || offline || Boolean(invalid) || expression.length < 2}
          onClick={preview}
        >
          Preview sample
        </Button>
        <Button
          primary
          type="submit"
          disabled={working || offline || Boolean(invalid) || expression.length < 2}
        >
          {working
            ? 'Working…'
            : saveError
              ? 'Try again'
              : mode === 'edit'
                ? 'Save formula'
                : 'Insert formula'}
        </Button>
      </div>
      <p className="sp-muted">
        Preview values are sample data. This design preview does not calculate expressions.
      </p>
      {notice && <p role="status">{notice}</p>}
    </form>
  );
}
