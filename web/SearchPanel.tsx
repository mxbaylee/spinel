import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { hasSearch, parseSearch } from '../src/shared/search.ts';
import type { SearchItem, SearchQuery } from '../src/shared/search.ts';
import type { FileItem } from '../src/shared/workspace.ts';
import { itemsRequest } from './itemsApi.ts';
import { parseSearchInput, serializeSearchInput } from '../src/shared/searchInput.ts';
import { SearchControls } from './SearchControls.tsx';
import { DashboardFiles } from './DashboardFiles.tsx';
import type { DashboardFilesProps } from './DashboardFiles.tsx';
import { searchWithinScope } from '../src/shared/searchScope.ts';
import type { SearchScope } from '../src/shared/searchScope.ts';
import { useDiagnostics } from './useDiagnostics.tsx';
import { beginOperation, diagnosticSource } from './operationDiagnostics.ts';

export function SearchPanel({
  query,
  onChange,
  loadedItems,
  onOpen,
  spacesEnabled = false,
  layout,
  actionsFor,
  offlineState,
  draftText,
  onDraftTextChange,
  scope = { kind: 'all' },
  scopeLabel = 'All accessible files',
  onSearchAll,
  onClear,
  scopeOverride = false,
  refreshKey = 0,
  onReady,
  viewControls,
}: {
  query: SearchQuery;
  onChange: (query: SearchQuery) => void;
  loadedItems: FileItem[];
  onOpen: (item: FileItem) => void;
  spacesEnabled?: boolean;
  layout?: DashboardFilesProps<FileItem>['layout'];
  actionsFor?: DashboardFilesProps<FileItem>['actionsFor'];
  offlineState?: DashboardFilesProps<FileItem>['offlineState'];
  draftText?: string;
  onDraftTextChange?: (text: string) => void;
  scope?: SearchScope;
  scopeLabel?: string;
  onSearchAll?: () => void;
  onClear?: () => void;
  scopeOverride?: boolean;
  refreshKey?: number;
  onReady?: () => void;
  viewControls?: ReactNode;
}) {
  const diagnostics = useDiagnostics();
  const active = hasSearch(query),
    key = new URLSearchParams(query).toString();
  // Keep the exact draft while the parent echoes a parsed query, preserving caret/spacing.
  const [draft, setDraft] = useState({ text: serializeSearchInput(query), key });
  const text = draftText ?? (draft.key === key ? draft.text : serializeSearchInput(query));
  const parsed = parseSearchInput(text);
  const invalid = !parsed.ok;
  const apply = (next: SearchQuery) => {
    const normalized = parseSearch(next);
    setDraft({
      text: serializeSearchInput(normalized),
      key: new URLSearchParams(normalized).toString(),
    });
    onDraftTextChange?.(serializeSearchInput(normalized));
    onChange(normalized);
  };
  const edit = (text: string) => {
    const next = parseSearchInput(text);
    setDraft({ text, key: next.ok ? new URLSearchParams(next.query).toString() : key });
    onDraftTextChange?.(text);
    if (next.ok) onChange(next.query);
  };
  const [server, setServer] = useState<{ key: string; items: SearchItem<FileItem>[] } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0);
  const scopeKey = scope.kind === 'folder' ? `folder:${scope.id}` : scope.kind;
  const requestKey = `${key}|${scopeKey}|${refresh}|${refreshKey}`;
  useEffect(() => {
    if (!active || invalid) return;
    let disposed = false;
    let finished: ReturnType<typeof beginOperation> | undefined;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(() => {
      finished = beginOperation(
        diagnosticSource(diagnostics, {
          component: 'dashboard',
          route: '/files',
        }),
        'search',
      );
      // Empty supported filters return the complete current authorized outer
      // catalog in one server transaction. Filter after deriving scope, never
      // infer descendants from filtered results or the dashboard's loaded cache.
      void itemsRequest<{ items: SearchItem<FileItem>[] }>('/search')
        .then((result) => {
          if (!disposed) {
            setServer({
              key: requestKey,
              items: searchWithinScope(result.items, query, scope, Date.now()),
            });
            finished?.('success');
          } else finished?.('cancelled');
        })
        .catch((cause) => {
          if (!disposed) {
            setError({
              key: requestKey,
              message: cause instanceof Error ? cause.message : 'Could not search. Try again.',
            });
            finished?.('failure');
          } else finished?.('cancelled');
        })
        .finally(() => {
          if (!disposed) setLoading(false);
        });
    }, 150);
    return () => {
      finished?.('cancelled');
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [active, invalid, requestKey]);
  useEffect(() => {
    if (!active || invalid) return;
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
  }, [active, invalid]);
  const failed = error?.key === requestKey ? error.message : '';
  const items = !failed && server?.key === requestKey ? server.items : [];
  const searching = loading || (!failed && server?.key !== requestKey);
  useEffect(() => {
    if (active && !invalid && !searching && !failed) onReady?.();
  }, [active, invalid, searching, failed, onReady]);
  const tags = [...new Set(loadedItems.flatMap((item) => item.tags))].sort();
  return (
    <section className="dashboard-search" aria-label="Search your workspace">
      <SearchControls
        query={query}
        viewControls={viewControls}
        canClearScope={scopeOverride}
        text={text}
        problem={parsed.ok ? '' : parsed.error}
        tags={tags}
        spacesEnabled={spacesEnabled}
        onEdit={edit}
        onApply={apply}
        onClear={() => {
          apply({ q: '', type: '', owner: '', tag: '', modified: '' });
          onClear?.();
        }}
      />
      <p className="search-scope">
        Searching: <strong>{scopeLabel}</strong>
        {scope.kind !== 'all' && onSearchAll && (
          <>
            {' '}
            <button onClick={onSearchAll}>Search all files</button>
          </>
        )}
      </p>
      {active && !invalid && (
        <section aria-label="Search results">
          <h2>Search results</h2>
          {failed ? (
            <p role="alert">
              {failed}{' '}
              <button onClick={() => setRefresh((value) => value + 1)}>Retry search</button>
            </p>
          ) : (
            <>
              <p role="status">
                {searching
                  ? 'Searching…'
                  : `${items.length} ${items.length === 1 ? 'result' : 'results'}`}
              </p>
              <DashboardFiles<SearchItem<FileItem>>
                items={items}
                layout={layout}
                onOpen={onOpen}
                actionsFor={actionsFor}
                offlineState={offlineState}
                label="Search result files"
                openLabel={(item) => `Open result ${item.name}`}
                details={(item) =>
                  item.paths.length
                    ? item.paths.join(' · ')
                    : item.access === 'owner' || item.placementParentId === null
                      ? 'My files'
                      : 'Shared with me'
                }
                emptyMessage={
                  searching ? '' : 'No matching files. Try another search or clear a filter.'
                }
              />
            </>
          )}
        </section>
      )}
    </section>
  );
}
