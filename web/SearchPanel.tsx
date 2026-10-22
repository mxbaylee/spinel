import { EntityIcon } from '../src/ui/EntityIcon.tsx';
import { useEffect, useState } from 'react';
import { emptySearch, hasSearch, searchCatalog, searchItems } from '../src/shared/search.ts';
import type { SearchItem, SearchQuery } from '../src/shared/search.ts';
import { FILE_KINDS, fileKindLabel } from '../src/shared/workspace.ts';
import type { FileItem } from '../src/shared/workspace.ts';
import { itemsRequest } from './itemsApi.ts';
import { SharedBadge } from './SharedItems.tsx';
import { TagLabels } from './DocumentTags.tsx';

export function SearchPanel({
  query,
  onChange,
  loadedItems,
  onOpen,
  spacesEnabled = false,
}: {
  query: SearchQuery;
  onChange: (query: SearchQuery) => void;
  loadedItems: FileItem[];
  onOpen: (item: FileItem) => void;
  spacesEnabled?: boolean;
}) {
  const active = hasSearch(query),
    key = new URLSearchParams(query).toString();
  const [server, setServer] = useState<{ key: string; items: SearchItem<FileItem>[] } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      void itemsRequest<{ items: SearchItem<FileItem>[] }>(`/search?${key}`)
        .then((result) => {
          if (!disposed) setServer({ key, items: result.items });
        })
        .catch((cause) => {
          if (!disposed)
            setError({
              key,
              message: cause instanceof Error ? cause.message : 'Could not search. Try again.',
            });
        })
        .finally(() => {
          if (!disposed) setLoading(false);
        });
    }, 150);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [active, key, refresh]);
  useEffect(() => {
    if (!active) return;
    const update = () => {
      if (!document.hidden) setRefresh((value) => value + 1);
    };
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    const timer = window.setInterval(update, 15000);
    return () => {
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
      window.clearInterval(timer);
    };
  }, [active]);
  const failed = error?.key === key ? error.message : '';
  const items = failed
    ? []
    : server?.key === key
      ? server.items
      : searchItems(searchCatalog(loadedItems), query, Date.now());
  const tags = [...new Set(loadedItems.flatMap((item) => item.tags))].sort();
  return (
    <section className="dashboard-search" aria-label="Search your workspace">
      <div className="search-filters">
        <label>
          Search files
          <input
            type="search"
            maxLength={200}
            value={query.q}
            placeholder="Title, folder path or tag"
            onChange={(event) => onChange({ ...query, q: event.target.value })}
          />
        </label>
        <label>
          File type
          <select
            value={query.type}
            onChange={(event) =>
              onChange({ ...query, type: event.target.value as SearchQuery['type'] })
            }
          >
            <option value="">All types</option>
            {FILE_KINDS.filter((kind) => kind !== 'space' || spacesEnabled).map((kind) => (
              <option key={kind} value={kind}>
                {fileKindLabel[kind]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ownership
          <select
            value={query.owner}
            onChange={(event) =>
              onChange({ ...query, owner: event.target.value as SearchQuery['owner'] })
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
            list="search-personal-tags"
            maxLength={100}
            value={query.tag}
            onChange={(event) => onChange({ ...query, tag: event.target.value })}
          />
        </label>
        <datalist id="search-personal-tags">
          {tags.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
        <label>
          Last modified
          <select
            value={query.modified}
            onChange={(event) =>
              onChange({ ...query, modified: event.target.value as SearchQuery['modified'] })
            }
          >
            <option value="">Any time</option>
            <option value="day">Past 24 hours</option>
            <option value="week">Past 7 days</option>
            <option value="month">Past 30 days</option>
          </select>
        </label>
        <button disabled={!active} onClick={() => onChange({ ...emptySearch })}>
          Clear search and filters
        </button>
      </div>
      {active && (
        <section aria-label="Search results">
          <h2>Search results</h2>
          <p>Across your files and shares.</p>
          {failed ? (
            <p role="alert">
              {failed}{' '}
              <button onClick={() => setRefresh((value) => value + 1)}>Retry search</button>
            </p>
          ) : (
            <>
              <p role="status">
                {loading
                  ? 'Searching…'
                  : `${items.length} ${items.length === 1 ? 'result' : 'results'}`}
              </p>
              <ul className="file-list">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      className="item-open"
                      aria-label={`Open result ${item.name}`}
                      onClick={() => onOpen(item)}
                    >
                      {item.kind !== 'folder' && <EntityIcon kind={item.kind} />}
                      {item.name} <span className="item-kind">{fileKindLabel[item.kind]}</span>
                    </button>
                    <SharedBadge item={item} />
                    {item.access === 'viewer' && <span>View only</span>}
                    <TagLabels tags={item.tags} />
                    <span className="search-paths">
                      {item.paths.length
                        ? item.paths.join(' · ')
                        : item.access === 'owner' || item.placementParentId === null
                          ? 'My files'
                          : 'Shared with me'}
                    </span>
                    <time dateTime={new Date(item.updatedAt).toISOString()}>
                      {new Date(item.updatedAt).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ul>
              {!loading && !items.length && (
                <p>No matching files. Try another search or clear a filter.</p>
              )}
            </>
          )}
        </section>
      )}
    </section>
  );
}
