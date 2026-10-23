import type { ReactNode } from 'react';
import { useId, useRef, useState } from 'react';
import { emptySearch, hasSearch } from '../src/shared/search.ts';
import type { SearchQuery } from '../src/shared/search.ts';
import { searchFilterFields, searchInputAsPlainText } from '../src/shared/searchInput.ts';
import { FILE_KINDS, fileKindLabel } from '../src/shared/workspace.ts';
import { Modal } from '../src/ui/redesign/Controls.tsx';
import './SearchPanel.css';

const ownership = { mine: 'Mine', shared: 'Shared with me' };
const modified = { day: 'Past 24 hours', week: 'Past 7 days', month: 'Past 30 days' };

/** The visible draft and the last valid query are deliberately separate while editing. */
export function SearchControls({
  query,
  text,
  problem,
  tags,
  spacesEnabled,
  onEdit,
  onApply,
  onClear,
  viewControls,
}: {
  query: SearchQuery;
  text: string;
  problem: string;
  tags: string[];
  spacesEnabled: boolean;
  onEdit: (text: string) => void;
  onApply: (query: SearchQuery) => void;
  onClear?: () => void;
  viewControls?: ReactNode;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [options, setOptions] = useState(query);
  const optionsProblem =
    options.q.length > 200
      ? 'Search words accept up to 200 characters. Shorten the text before applying.'
      : options.tag.length > 100
        ? 'Tag accepts up to 100 characters. Shorten the tag before applying.'
        : '';
  const fallback = searchInputAsPlainText(text, query);
  const labels = {
    type: query.type ? `Type: ${fileKindLabel[query.type]}` : '',
    owner: query.owner ? `Ownership: ${ownership[query.owner]}` : '',
    tag: query.tag ? `Tag: ${query.tag}` : '',
    modified: query.modified ? `Modified: ${modified[query.modified]}` : '',
  };
  return (
    <div className="search-builder">
      <div className="search-builder-toolbar">
        <label className="search-builder-input">
          Search files
          <input
            ref={input}
            type="search"
            value={text}
            placeholder="Title, folder path or tag"
            aria-invalid={!!problem}
            aria-describedby={`${id}-help${problem ? ` ${id}-error` : ''}`}
            onChange={(event) => onEdit(event.target.value)}
          />
        </label>
        <button
          disabled={!!problem}
          aria-describedby={problem ? `${id}-error` : undefined}
          onClick={() => {
            setOptions(query);
            setOptionsOpen(true);
          }}
        >
          Search options
        </button>
        {viewControls}
        {(text || hasSearch(query)) && (
          <button
            disabled={!text && !hasSearch(query)}
            onClick={() => (onClear ? onClear() : onApply({ ...emptySearch }))}
          >
            Clear search and filters
          </button>
        )}
      </div>
      <details id={`${id}-help`} className="search-builder-help">
        <summary>Search help</summary>
        <p>
          Search words match titles, accessible folder paths and your tags. Add filters with Search
          options, or type <code>type:sheet owner:shared tag:travel modified:week</code>. Use each
          filter once. Quote values with spaces, such as <code>tag:"summer travel"</code>. To find
          the literal words <code>type:sheet</code>, type <code>"type:sheet"</code>. Search words
          allow 200 characters and each filter allows 100; quotes and escapes do not count toward
          those limits.
        </p>
      </details>
      {problem && (
        <div id={`${id}-error`} className="search-builder-error" role="status" aria-live="polite">
          <p>{problem} Results are paused until the search is valid.</p>
          <p>Options and filter removal are paused too. You can keep typing or clear the search.</p>
          <button
            disabled={!fallback.ok}
            onClick={() => {
              if (fallback.ok) onApply(fallback.query);
            }}
          >
            Search this as plain text
          </button>
          <p>
            Treats everything in the field as search words. Existing filters and the current scope
            are retained.
            {!fallback.ok && ` ${fallback.error}`}
          </p>
        </div>
      )}
      {searchFilterFields.some((field) => query[field]) && (
        <div
          className="search-builder-conditions"
          aria-label={problem ? 'Last valid filters' : 'Active filters'}
        >
          {problem && <span>Last valid filters — results paused:</span>}
          {searchFilterFields
            .filter((field) => query[field])
            .map((field) => (
              <span className={`search-condition search-condition-${field}`} key={field}>
                <span>{labels[field]}</span>
                <button
                  aria-label={`Remove ${labels[field]}`}
                  disabled={!!problem}
                  aria-describedby={problem ? `${id}-error` : undefined}
                  onClick={() => {
                    onApply({ ...query, [field]: '' });
                    input.current?.focus();
                  }}
                >
                  ×
                </button>
              </span>
            ))}
        </div>
      )}
      <Modal
        title="Search options"
        icon="info"
        description="Search words and filters edit the same query. All filters apply together within the current scope."
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
      >
        <form
          className="search-options-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (optionsProblem) return;
            onApply(options);
            setOptionsOpen(false);
          }}
        >
          <label>
            Search words
            <input
              value={options.q}
              aria-invalid={options.q.length > 200}
              aria-describedby={optionsProblem ? `${id}-options-error` : undefined}
              onChange={(event) => setOptions({ ...options, q: event.target.value })}
            />
          </label>
          <label>
            File type
            <select
              value={options.type}
              onChange={(event) =>
                setOptions({ ...options, type: event.target.value as SearchQuery['type'] })
              }
            >
              <option value="">All types</option>
              {FILE_KINDS.filter(
                (kind) => kind !== 'space' || spacesEnabled || options.type === 'space',
              ).map((kind) => (
                <option key={kind} value={kind}>
                  {fileKindLabel[kind]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Ownership
            <select
              value={options.owner}
              onChange={(event) =>
                setOptions({ ...options, owner: event.target.value as SearchQuery['owner'] })
              }
            >
              <option value="">Mine and shared</option>
              <option value="mine">Mine</option>
              <option value="shared">Shared with me</option>
            </select>
          </label>
          <label>
            Tag
            <input
              list={`${id}-tags`}
              value={options.tag}
              aria-invalid={options.tag.length > 100}
              aria-describedby={optionsProblem ? `${id}-options-error` : undefined}
              onChange={(event) => setOptions({ ...options, tag: event.target.value })}
            />
          </label>
          <datalist id={`${id}-tags`}>
            {tags.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
          <label>
            Last modified
            <select
              value={options.modified}
              onChange={(event) =>
                setOptions({ ...options, modified: event.target.value as SearchQuery['modified'] })
              }
            >
              <option value="">Any time</option>
              <option value="day">Past 24 hours</option>
              <option value="week">Past 7 days</option>
              <option value="month">Past 30 days</option>
            </select>
          </label>
          {optionsProblem && (
            <p id={`${id}-options-error`} role="status">
              {optionsProblem}
            </p>
          )}
          <button type="submit" disabled={!!optionsProblem}>
            Apply search
          </button>
        </form>
      </Modal>
    </div>
  );
}
