import { EditorFrame } from './EditorFrame.tsx';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { EntityIcon } from '../src/ui/EntityIcon.tsx';
import { Button } from '../src/ui/redesign/Controls.tsx';
import { SpaceShell } from './SpaceShell.tsx';
import type { SpaceUser } from './SpaceShell.tsx';
import type { LocalStart } from './offline/localStart.ts';
import { selectOfflineSpace } from './offline/spaceCopies.ts';
import type { OfflineSpaceSelection } from './offline/spaceCopies.ts';
import { readSpaceLocation, spaceHref } from './spaceNavigation.ts';
import './spaceOffline.css';

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
  useEffect(() => {
    const changed = () => setRoute(readSpaceLocation(location));
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  const selection = selectOfflineSpace(local, user.id, route);
  return (
    <OfflineSpaceView
      user={user}
      selection={selection}
      onExit={onExit}
      onProfile={onProfile}
      viewer={
        selection.selected && selection.spaceId ? (
          <Suspense fallback={<p role="status">Opening offline copy…</p>}>
            <OfflineViewer
              key={selection.spaceId + ':' + selection.selected.itemId}
              accountId={user.id}
              itemId={selection.selected.itemId}
              spaceId={selection.spaceId}
            />
          </Suspense>
        ) : null
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
}: {
  user: SpaceUser;
  selection: OfflineSpaceSelection;
  onExit(): void;
  onProfile(): void;
  viewer: ReactNode;
}) {
  const { root, spaceId, copies, selected, problem } = selection;
  const shell = (
    <SpaceShell
      user={user}
      connection="offline"
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
        {selected && <span className="space-access">Read only</span>}
      </header>
      {problem ? (
        <div className="space-content space-offline-empty">
          <p role="status">{problems[problem]}</p>
          <Button onClick={onExit}>My files</Button>
        </div>
      ) : (
        selected && (
          <>
            <p className="space-limitations">
              Prepared {new Date(selected.downloadedAt).toLocaleString()}. Reconnect to get the
              latest changes.
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
      connection="offline"
      access="Read only"
      onBack={onExit}
      backLabel="My files"
    >
      {shell}
    </EditorFrame>
  ) : (
    shell
  );
}
