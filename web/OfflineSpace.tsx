import { EditorFrame } from './EditorFrame.tsx';
import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { EntityIcon } from '../src/ui/EntityIcon.tsx';
import { Button } from '../src/ui/redesign/Controls.tsx';
import { SpaceShell } from './SpaceShell.tsx';
import type { SpaceUser } from './SpaceShell.tsx';
import type { LocalStart } from './offline/localStart.ts';
import { selectOfflineSpace, spaceCopies } from './offline/spaceCopies.ts';
import type { OfflineSpaceSelection } from './offline/spaceCopies.ts';
import type { OfflineDownload } from './offline/offlineStore.ts';
import { useOfflineDownloads } from './offline/useOfflineDownloads.ts';
import { readSpaceLocation, spaceHref } from './spaceNavigation.ts';
import type { SpaceLocation } from './spaceNavigation.ts';
import './spaceOffline.css';
import type { ConnectionState } from './connectionState.ts';

const OfflineViewer = lazy(() =>
  import('./OfflineViewer.tsx').then((module) => ({ default: module.OfflineViewer })),
);

export function OfflineSpace({
  local,
  user,
  onExit,
  onProfile,
}: {
  local: LocalStart;
  user: SpaceUser;
  onExit(): void;
  onProfile(): void;
}) {
  const [route, setRoute] = useState(() => readSpaceLocation(location));
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [dirty, setDirty] = useState(false);
  const offline = useOfflineDownloads(user, local, () => null);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    const changed = () => setRoute(readSpaceLocation(location));
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  return (
    <OfflineSpaceRoute
      key={user.id + ':' + local.user.id + ':' + JSON.stringify(route)}
      user={user}
      local={local}
      route={route}
      downloads={offline.downloads}
      onExit={onExit}
      onProfile={onProfile}
      connection={connection ?? 'offline'}
      renderViewer={(selected, spaceId) => (
        <Suspense fallback={<p role="status">Opening offline copy…</p>}>
          <OfflineViewer
            key={spaceId + ':' + selected.itemId}
            accountId={user.id}
            itemId={selected.itemId}
            spaceId={spaceId}
            onDirty={setDirty}
            onConnectionState={setConnection}
          />
        </Suspense>
      )}
    />
  );
}

/** A route opens once; later inventory changes affect labels, not its editor lifetime. */
export function OfflineSpaceRoute({
  local,
  user,
  route,
  downloads,
  onExit,
  onProfile,
  renderViewer,
  connection = 'offline',
}: {
  local: LocalStart;
  user: SpaceUser;
  route: SpaceLocation;
  downloads: ReadonlyMap<string, OfflineDownload>;
  onExit(): void;
  onProfile(): void;
  renderViewer(selected: OfflineDownload, spaceId: string): ReactNode;
  connection?: ConnectionState;
}) {
  const latest = selectOfflineSpace(
    { ...local, downloads: [...downloads.values()] },
    user.id,
    route,
  );
  const [opened, setOpened] = useState(() => (latest.selected ? latest : null));
  useLayoutEffect(() => {
    // A route initially lacking a copy can become ready after a completed read.
    // Once admitted, only the outer route/account key may replace its editor.
    if (!opened && latest.selected) setOpened(latest);
  }, [opened, latest]);
  let selection = latest;
  if (opened?.selected && opened.spaceId && local.user.id === user.id) {
    const current = downloads.get(opened.selected.itemId);
    const selected =
      current?.spaceId === opened.spaceId
        ? current
        : {
            ...opened.selected,
            available: false,
            problem: 'The saved device copy could not be verified.',
          };
    const copies = spaceCopies(downloads.values(), opened.spaceId);
    // Keep the current page reachable while its mounted editor finishes recovery.
    // This retained label does not claim that its device bytes still exist.
    if (!copies.some((copy) => copy.itemId === selected.itemId)) copies.push(selected);
    selection = { ...opened, copies: spaceCopies(copies, opened.spaceId), selected };
  }
  return (
    <OfflineSpaceView
      user={user}
      selection={selection}
      onExit={onExit}
      onProfile={onProfile}
      connection={connection}
      viewer={
        selection.selected && selection.spaceId
          ? renderViewer(opened?.selected ?? selection.selected, selection.spaceId)
          : null
      }
    />
  );
}

const problems = {
  account:
    'These offline copies belong to another account. Sign in with the account that prepared this device.',
  index:
    'Reconnect to browse your Spaces. Pages you prepared on this device can be opened from their Space links.',
  route: 'This Space link is unavailable. Reconnect and open the Space from My files.',
  trash: 'Space Trash needs a connection. You can still open the pages prepared on this device.',
  missing: 'This page needs a connection. It has not been prepared in this Space on this device.',
  empty:
    'No pages from this Space are prepared on this device. Reconnect and make a Doc or Sheet available offline.',
};

/** The real shell and prepared-page list; stories supply a labeled native-viewer fixture. */
export function OfflineSpaceView({
  user,
  selection,
  onExit,
  onProfile,
  viewer,
  connection = 'offline',
}: {
  user: SpaceUser;
  selection: OfflineSpaceSelection;
  onExit(): void;
  onProfile(): void;
  viewer: ReactNode;
  connection?: ConnectionState;
}) {
  const { root, spaceId, copies, selected, problem } = selection;
  const attention = selected?.available === false;
  const access = attention
    ? 'Needs attention'
    : selected?.readOnly
      ? 'Read only'
      : 'On this device';
  const shell = (
    <SpaceShell
      user={user}
      connection={connection}
      documentOpen={Boolean(selected)}
      onExit={onExit}
      onProfile={onProfile}
      navigation={
        spaceId && copies.length
          ? (close) => (
              <nav className="space-navigation" aria-label="Prepared pages">
                <h2>On this device</h2>
                <p className="space-copy-caption">{root?.name ?? 'This Space'}</p>
                <div className="space-tree-scroll">
                  <ul className="space-copy-list">
                    {copies.map((copy) => (
                      <li key={copy.itemId}>
                        <a
                          className="space-page-link"
                          href={spaceHref(spaceId, { kind: 'page', id: copy.itemId })}
                          aria-current={copy.itemId === selected?.itemId ? 'page' : undefined}
                          onClick={close}
                        >
                          <EntityIcon kind={copy.kind} size={20} />
                          <span>{copy.name}</span>
                        </a>
                        {copy.available === false && (
                          <span className="sp-muted">Needs attention</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="space-copy-caption">Reconnect to browse all pages in this Space.</p>
              </nav>
            )
          : undefined
      }
    >
      <header className="space-page-header" hidden={Boolean(selected && !problem)}>
        <EntityIcon kind={selected?.kind ?? 'space'} size={32} />
        <div className="space-page-identity">
          <p>{root ? 'Space · ' + root.name : 'Space'}</p>
          <h1>
            {selected?.name ??
              (problem === 'index' ? 'Your Spaces' : (root?.name ?? 'Space unavailable'))}
          </h1>
        </div>
        {selected && <span className="space-access">{access}</span>}
      </header>
      {problem ? (
        <div className="space-content space-offline-empty">
          <p role="status">{problems[problem]}</p>
          <Button onClick={onExit}>My files</Button>
        </div>
      ) : (
        selected && (
          <>
            <p
              className="space-limitations"
              role={attention ? 'status' : undefined}
              aria-label={attention ? 'Device copy status' : undefined}
            >
              {attention ? (
                <>
                  {selected.problem ?? 'The saved device copy could not be verified.'} Keep this
                  page open while you save or recover your work.
                </>
              ) : (
                <>
                  Prepared {new Date(selected.downloadedAt).toLocaleString()}. Reconnect to get the
                  latest changes.
                </>
              )}
            </p>
            <div className="space-native-editor space-offline-viewer">{viewer}</div>
          </>
        )
      )}
    </SpaceShell>
  );
  return selected && !problem ? (
    <EditorFrame
      name={selected.name}
      contextLabel={root ? `Space · ${root.name}` : undefined}
      connection={connection}
      access={access}
      onBack={onExit}
      backLabel="My files"
    >
      {shell}
    </EditorFrame>
  ) : (
    shell
  );
}
