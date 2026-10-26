import { EditorFrame } from './EditorFrame.tsx';
import { revokeGuestView } from './guestRevocation.ts';
import type { SpaceRootActionMode } from './SpaceRootActions.tsx';
import { canAdminister, accessLabel } from '../src/shared/workspace.ts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  SpaceBootstrap,
  SpaceDeletePreview,
  SpaceNode,
  SpaceRecoveryItem,
  SpaceRestoreResult,
  SpaceRoot,
  SpaceTrashListing,
  SpaceTreeData,
} from '../src/shared/spaces.ts';
import type { ItemAccess, ItemKind, SpaceFile } from '../src/shared/workspace.ts';
import { EntityIcon } from '../src/ui/EntityIcon.tsx';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { ActionMenu, Button, Modal } from '../src/ui/redesign/Controls.tsx';
import type { NavigationGuard } from './navigation.ts';
import type { ConnectionState } from './connectionState.ts';
import { SpaceShell } from './SpaceShell.tsx';
import type { SpaceUser } from './SpaceShell.tsx';
import { SpaceTree } from './SpaceTree.tsx';
import { SpaceItemDialog } from './SpaceItemDialog.tsx';
import type { SpaceDialogAction, SpaceDialogValue } from './SpaceItemDialog.tsx';
import { SpaceTrash } from './SpaceTrash.tsx';
import {
  SpaceApiError,
  spaceAccessDenied,
  spaceRequestMessage,
  spacesRequest,
} from './spacesApi.ts';
import {
  createSpaceNavigation,
  readSpaceLocation,
  rememberSpacePage,
  rememberedSpacePage,
  rememberSpaceRoot,
  rememberedSpaceRoot,
  selectedSpacePage,
  spaceAncestors,
  spaceHref,
  spaceSubtree,
} from './spaceNavigation.ts';
import type { SpaceLocation } from './spaceNavigation.ts';
import { SpaceRootActions } from './SpaceRootActions.tsx';
import { SpaceOfflineActions } from './SpaceOfflineActions.tsx';
import { AccessState } from './AccessState.tsx';

export interface SpaceEditorProps {
  spaceId: string;
  saveStatusTarget: HTMLElement | null;
  item: SpaceNode;
  access: ItemAccess;
  onDirty(dirty: boolean): void;
  onConnectionState(state: ConnectionState | null): void;
}

export interface SpaceProps {
  user?: SpaceUser;
  guest?: boolean;
  navigation: NavigationGuard;
  connection: ConnectionState;
  onExit(): void;
  onConnectionState?(state: ConnectionState | null): void;
  renderEditor(props: SpaceEditorProps): ReactNode;
}

type OpenPage = { spaceId: string; item: SpaceNode; access: ItemAccess };

/** One native Space shell; guest navigation stays inside its current root link. */
export function Space({
  user,
  guest = false,
  navigation,
  connection,
  onExit,
  onConnectionState,
  renderEditor,
}: SpaceProps) {
  const [rootAction, setRootAction] = useState<SpaceRootActionMode | null>(null);
  const rootActionTrigger = useRef<HTMLButtonElement | null>(null);
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [route, setRoute] = useState<SpaceLocation>(() => readSpaceLocation(location));
  const routeRef = useRef(route);
  routeRef.current = route;
  const routeRevision = useRef(0);
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const connectionCallback = useRef(onConnectionState);
  connectionCallback.current = onConnectionState;
  const navigator = useRef<ReturnType<typeof createSpaceNavigation> | null>(null);
  const [bootstrap, setBootstrap] = useState<SpaceBootstrap | null>(null);
  const [tree, setTree] = useState<SpaceTreeData | null>(null);
  const [trash, setTrash] = useState<SpaceTrashListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [fresh, setFresh] = useState(false);
  const [denied, setDenied] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [trashError, setTrashError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [notice, setNotice] = useState('');
  const [action, setAction] = useState<SpaceDialogAction | null>(null);
  const pagesButton = useRef<HTMLButtonElement>(null);
  const returnToPages = useRef(false);
  const [actionError, setActionError] = useState('');
  const [preview, setPreview] = useState<SpaceDeletePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  const refresh = useRef<(replace?: boolean) => Promise<void>>(async () => {});
  const cancelRead = useRef<() => void>(() => {});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [openPage, setOpenPage] = useState<OpenPage | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    if (action || !returnToPages.current) return;
    returnToPages.current = false;
    // The originating menu was in a drawer that has now unmounted. Restore
    // focus to its visible Pages trigger after the metadata dialog closes.
    const frame = requestAnimationFrame(() => {
      const target = pagesButton.current;
      if (target?.isConnected && target.getClientRects().length) target.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [action]);

  // The existing guard clears its dirty bit when a departure is accepted.
  // Keep the fence until navigation actually commits (a trash request can fail).
  const allow = useCallback(() => {
    const pending = dirtyRef.current;
    const accepted = navigationRef.current.allow();
    if (pending) navigationRef.current.dirty(true);
    return accepted;
  }, []);
  const acceptRoute = useCallback((next: SpaceLocation) => {
    routeRevision.current++;
    routeRef.current = next;
    dirtyRef.current = false;
    setDirty(false);
    navigationRef.current.dirty(false);
    setRoute(next);
    setAction(null);
    setPreview(null);
    setActionError('');
    setOperationError('');
    setNotice('');
  }, []);
  useEffect(() => {
    mounted.current = true;
    const current = createSpaceNavigation(window, allow, acceptRoute);
    navigator.current = current;
    return () => {
      mounted.current = false;
      current.dispose();
      navigator.current = null;
      mutation.current?.abort();
      connectionCallback.current?.(null);
    };
  }, [allow, acceptRoute]);
  const go = (href: string, options?: { replace?: boolean; checked?: boolean }) =>
    navigator.current?.navigate(href, options) ?? false;
  const depart = (leave: () => void) => {
    if (!allow()) return;
    // The accepted full-document departure must not ask again in beforeunload.
    navigationRef.current.dirty(false);
    try {
      leave();
    } catch (error) {
      navigationRef.current.dirty(dirtyRef.current);
      throw error;
    }
  };
  const exit = () => depart(onExit);
  const profile = () => depart(() => location.assign('/profile'));
  const spaceId = route.kind === 'space' ? route.spaceId : null;
  const trashView = route.kind === 'space' && route.selection.kind === 'trash';
  const currentTree = tree?.space.id === spaceId ? tree : null;
  const canEdit = canAdminister(currentTree?.access) || currentTree?.access === 'editor';
  const unavailableManagement = !fresh || connection === 'offline' || denied;

  useEffect(() => {
    setExpanded(new Set());
    setTree(null);
    setTrash(null);
    setBootstrap(null);
    setPreview(null);
    setAction(null);
    setNotice('');
    setOperationError('');
    setLoadError('');
    setTrashError('');
    setActionError('');
    setDenied(false);
    setFresh(false);
    setLoading(true);
    mutation.current?.abort();
    busyRef.current = false;
    setBusy(false);
  }, [spaceId, user?.id, route.kind, guest]);

  useEffect(() => {
    let disposed = false;
    let request: AbortController | null = null;
    const load = async (replace = false) => {
      if (disposed || busyRef.current || route.kind === 'unavailable' || (request && !replace))
        return;
      request?.abort();
      const active = new AbortController();
      request = active;
      const signal = AbortSignal.any([active.signal, AbortSignal.timeout(5000)]);
      const current = () => !disposed && request === active && !active.signal.aborted;
      try {
        if (spaceId) {
          const result = await spacesRequest<SpaceTreeData>('/' + spaceId, { signal });
          if (!current()) return;
          setTree(result);
          setDenied(false);
          setFresh(true);
          setLoadError('');
          if (result.access !== 'owner') setPreview(null);
          if (result.access === 'viewer') {
            setTrash(null);
            setPreview(null);
            setAction(null);
            if (trashView) setTrashError('Space Trash is available to account editors.');
          } else if (trashView && !guest) {
            try {
              const listing = await spacesRequest<SpaceTrashListing>('/' + spaceId + '/trash', {
                signal,
              });
              if (current()) {
                setTrash(listing);
                setTrashError('');
              }
            } catch (error) {
              if (!current()) return;
              if (spaceAccessDenied(error)) {
                setTrash(null);
                setPreview(null);
              }
              setTrashError(spaceRequestMessage(error));
              setFresh(false);
            }
          }
        } else if (!guest) {
          const result = await spacesRequest<SpaceBootstrap>('', { signal });
          if (!current()) return;
          setBootstrap(result);
          setDenied(false);
          setFresh(true);
          setLoadError('');
        }
      } catch (error) {
        if (!current()) return;
        setFresh(false);
        setLoadError(spaceRequestMessage(error));
        if (spaceAccessDenied(error)) {
          if (guest) {
            revokeGuestView();
            if (disposed) return;
          }
          setDenied(true);
          setTree(null);
          setBootstrap(null);
          setTrash(null);
          setPreview(null);
          setAction(null);
        }
      } finally {
        if (request === active) {
          request = null;
          if (!disposed) setLoading(false);
        }
      }
    };
    refresh.current = load;
    cancelRead.current = () => {
      request?.abort();
      request = null;
    };
    if (route.kind === 'unavailable') setLoading(false);
    else void load();
    const focus = () => {
      if (document.visibilityState !== 'hidden') void load();
    };
    const interval = setInterval(focus, 5000);
    window.addEventListener('focus', focus);
    window.addEventListener('online', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      disposed = true;
      request?.abort();
      clearInterval(interval);
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [spaceId, trashView, route.kind, user?.id, guest]);

  const selection =
    route.kind === 'space' && currentTree
      ? selectedSpacePage(
          currentTree,
          route.selection,
          user && !guest ? rememberedSpacePage(user.id, currentTree.space.id) : null,
        )
      : { item: null, missing: false };
  const selectedId = selection.item?.id ?? null;
  const ancestorIds = useMemo(
    () =>
      currentTree && selectedId
        ? spaceAncestors(currentTree.items, selectedId).map((item) => item.id)
        : [],
    [currentTree, selectedId],
  );
  const ancestorKey = ancestorIds.join('/');
  useEffect(() => {
    if (!currentTree) return;
    if (user && !guest) rememberSpaceRoot(user.id, currentTree.space.id);
    if (selection.item) {
      if (user && !guest) rememberSpacePage(user.id, currentTree.space.id, selection.item.id);
      if (route.kind === 'space' && route.selection.kind === 'default')
        go(spaceHref(currentTree.space.id, { kind: 'page', id: selection.item.id }), {
          replace: true,
          checked: true,
        });
    }
  }, [currentTree?.space.id, selectedId, user?.id, guest]);
  useEffect(() => {
    if (!ancestorIds.length) return;
    setExpanded((previous) => new Set([...previous, ...ancestorIds]));
  }, [spaceId, selectedId, ancestorKey]);

  useEffect(() => {
    if (selection.item && currentTree && !trashView) {
      setOpenPage({
        spaceId: currentTree.space.id,
        item: selection.item,
        access: currentTree.access,
      });
    } else if (!dirtyRef.current) {
      setOpenPage(null);
    }
  }, [currentTree, selectedId, trashView, spaceId, dirty]);
  const pageMatchesRoute =
    openPage &&
    route.kind === 'space' &&
    openPage.spaceId === route.spaceId &&
    route.selection.kind !== 'trash' &&
    (route.selection.kind === 'default' || route.selection.id === openPage.item.id);
  const visiblePage = pageMatchesRoute && (selection.item || dirty) ? openPage : null;
  const editorKey = visiblePage ? visiblePage.spaceId + '/' + visiblePage.item.id : null;
  useEffect(() => {
    setRootAction(null);
    setOfflineOpen(false);
  }, [editorKey]);
  const activeEditor = useRef(editorKey);
  activeEditor.current = editorKey;
  const onDirty = useCallback(
    (value: boolean) => {
      if (activeEditor.current !== editorKey) return;
      dirtyRef.current = value;
      setDirty(value);
      navigationRef.current.dirty(value);
    },
    [editorKey],
  );
  const publishConnection = useCallback(
    (value: ConnectionState | null) => {
      if (activeEditor.current === editorKey) connectionCallback.current?.(value);
    },
    [editorKey],
  );
  useEffect(() => {
    if (!editorKey) connectionCallback.current?.(null);
  }, [editorKey]);
  useEffect(() => {
    document.title = currentTree
      ? `${trashView ? 'Space Trash' : (selection.item?.name ?? currentTree.space.name)} — ${currentTree.space.name} — Spinel`
      : 'Spaces — Spinel';
    return () => {
      document.title = 'Spinel';
    };
  }, [currentTree?.space.name, selection.item?.name, trashView]);

  async function mutate<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    success: (result: T) => void,
  ) {
    if (busyRef.current || unavailableManagement) return;
    const active = new AbortController();
    mutation.current = active;
    const startingSpace = spaceId;
    const startingRevision = routeRevision.current;
    const current = () =>
      mounted.current &&
      !active.signal.aborted &&
      (routeRef.current.kind === 'space' ? routeRef.current.spaceId : null) === startingSpace;
    const sameView = () => current() && routeRevision.current === startingRevision;
    // A read that started before this mutation cannot publish its old tree
    // after the write. The next read is forced even if a poll was already pending.
    cancelRead.current();
    busyRef.current = true;
    setBusy(true);
    setActionError('');
    setTrashError('');
    setOperationError('');
    setNotice('');
    try {
      const result = await operation(AbortSignal.any([active.signal, AbortSignal.timeout(15_000)]));
      if (!current()) return;
      // Navigation may have been accepted while the request was in flight.
      // Its server result still stands, but its old selection/notice does not.
      if (sameView()) success(result);
      busyRef.current = false;
      if (current()) await refresh.current(true);
      return true;
    } catch (error) {
      if (!current()) return;
      if (sameView()) {
        const stalePreview = preview && error instanceof SpaceApiError && error.status === 409;
        const message =
          spaceRequestMessage(error) +
          (stalePreview ? ' Review the current subtree again before deleting.' : '');
        setActionError(message);
        if (trashView || !action) setOperationError(message);
        if (stalePreview) setPreview(null);
      }
      busyRef.current = false;
      await refresh.current(true);
      return false;
    } finally {
      if (mutation.current === active) {
        mutation.current = null;
        busyRef.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }

  function submit(value: SpaceDialogValue) {
    if (!action) return;
    if (action.mode === 'root') {
      if (guest || !user) return;
      void mutate(
        (signal) =>
          spacesRequest<{ space: SpaceRoot }>('', { method: 'POST', body: value, signal }),
        (result) => {
          setAction(null);
          go(spaceHref(result.space.id), { checked: true });
        },
      );
      return;
    }
    if (!currentTree || !canEdit) return;
    const prefix = '/' + currentTree.space.id + '/items';
    if (action.mode === 'add') {
      void mutate(
        (signal) =>
          spacesRequest<{ item: SpaceNode }>(prefix, { method: 'POST', body: value, signal }),
        ({ item }) => {
          setAction(null);
          setTree((previous) =>
            previous?.space.id === currentTree.space.id
              ? {
                  ...previous,
                  items: [...previous.items.filter((entry) => entry.id !== item.id), item],
                }
              : previous,
          );
          setNotice(`${item.name} created.`);
          if (item.parentId !== currentTree.space.id)
            setExpanded((previous) => new Set([...previous, item.parentId]));
          if (item.kind !== 'folder')
            go(spaceHref(currentTree.space.id, { kind: 'page', id: item.id }));
        },
      );
    } else if (action.mode === 'trash') {
      const affectsPage =
        openPage?.spaceId === currentTree.space.id &&
        spaceSubtree(currentTree.items, action.item.id).has(openPage.item.id);
      if (affectsPage && !allow()) return;
      void mutate(
        (signal) =>
          spacesRequest(prefix + '/' + action.item.id, { method: 'DELETE', body: {}, signal }),
        () => {
          setAction(null);
          setTree((previous) => {
            if (previous?.space.id !== currentTree.space.id) return previous;
            const removed = spaceSubtree(previous.items, action.item.id);
            return { ...previous, items: previous.items.filter((item) => !removed.has(item.id)) };
          });
          if (affectsPage)
            go(spaceHref(currentTree.space.id, guest ? { kind: 'default' } : { kind: 'trash' }), {
              checked: true,
            });
          setNotice(`${action.item.name} moved to Space Trash with its contents.`);
        },
      );
    } else {
      void mutate(
        (signal) =>
          spacesRequest<{ item: SpaceNode }>(prefix + '/' + action.item.id, {
            method: 'PATCH',
            body: value,
            signal,
          }),
        ({ item }) => {
          setAction(null);
          setNotice(action.mode === 'rename' ? `${item.name} renamed.` : `${item.name} moved.`);
        },
      );
    }
  }
  function restore(item: SpaceRecoveryItem) {
    if (!spaceId || !canEdit || guest) return;
    void mutate(
      (signal) =>
        spacesRequest<SpaceRestoreResult>('/' + spaceId + '/trash/' + item.id + '/restore', {
          method: 'POST',
          body: {},
          signal,
        }),
      (result) => {
        setPreview(null);
        setNotice(
          result.reason
            ? `${item.name} restored to the Space root because its original location is unavailable.`
            : `${item.name} restored to its original location${result.restoredCount > 1 ? ', with its contents' : ''}.`,
        );
      },
    );
  }
  function previewDelete(item: SpaceRecoveryItem) {
    if (!spaceId || currentTree?.access !== 'owner') return;
    void mutate(
      (signal) =>
        spacesRequest<SpaceDeletePreview>('/' + spaceId + '/trash/' + item.id + '/delete-preview', {
          signal,
        }),
      setPreview,
    );
  }
  function confirmDelete(value: SpaceDeletePreview) {
    if (!spaceId || currentTree?.access !== 'owner') return;
    void mutate(
      (signal) =>
        spacesRequest('/' + spaceId + '/trash/' + value.root.id, {
          method: 'DELETE',
          body: { version: value.version },
          signal,
        }),
      () => {
        setPreview(null);
        setNotice(`${value.root.name} and its contents permanently deleted.`);
      },
    );
  }
  const addMenu = (kind: ItemKind) => {
    returnToPages.current = window.matchMedia('(max-width: 900px)').matches;
    setActionError('');
    setAction({ mode: 'add', kind });
  };
  const navigationView = currentTree
    ? (close: () => void) => (
        <nav className="space-navigation" aria-label="Pages">
          <h2>{currentTree.space.name}</h2>
          <SpaceTree
            space={currentTree.space}
            items={currentTree.items}
            selectedId={selectedId}
            expandedIds={expanded}
            onToggle={(id) =>
              setExpanded((previous) => {
                const next = new Set(previous);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onOpen={(id) => {
              const accepted = go(spaceHref(currentTree.space.id, { kind: 'page', id }));
              if (accepted) close();
              return accepted;
            }}
            onAction={(value) => {
              returnToPages.current = window.matchMedia('(max-width: 900px)').matches;
              close();
              setActionError('');
              setAction(value);
            }}
            canEdit={canEdit}
            disabled={busy || unavailableManagement}
          />
          {canEdit && (
            <ActionMenu
              label="Add page"
              actions={(['doc', 'sheet', 'folder'] as const).map((kind) => ({
                label: kind === 'doc' ? 'Doc' : kind === 'sheet' ? 'Sheet' : 'Folder',
                disabled: busy || unavailableManagement,
                onClick: () => {
                  close();
                  addMenu(kind);
                },
              }))}
            >
              <ProfileIcon icon="lucide:plus" /> Add page
            </ActionMenu>
          )}
          {canEdit && !guest && (
            <a
              className="space-trash-link"
              href={spaceHref(currentTree.space.id, { kind: 'trash' })}
              aria-current={trashView ? 'page' : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                if (go(spaceHref(currentTree.space.id, { kind: 'trash' }))) close();
              }}
            >
              <ProfileIcon icon="lucide:trash-2" /> Space Trash
            </a>
          )}
        </nav>
      )
    : undefined;
  const recent =
    user &&
    bootstrap?.spaces.find(({ space }) => space.id === rememberedSpaceRoot(user.id))?.space.id;
  const rootFile: SpaceFile | null = currentTree
    ? {
        ...currentTree.space,
        kind: 'space',
        access: currentTree.access,
        tags: [],
      }
    : null;
  const rootControls = (
    <SpaceRootActions
      item={rootFile!}
      initialMode={visiblePage ? (rootAction ?? undefined) : undefined}
      finalFocus={
        visiblePage
          ? () => (rootActionTrigger.current?.isConnected ? rootActionTrigger.current : true)
          : undefined
      }
      onClose={() => setRootAction(null)}
      beforeChange={allow}
      onChanged={(item) => {
        setRootAction(null);
        setTree((previous) =>
          previous && previous.space.id === item.id
            ? {
                ...previous,
                space: { ...previous.space, name: item.name, parentId: item.parentId },
              }
            : previous,
        );
        void refresh.current(true);
      }}
      onTrashed={() => {
        navigationRef.current.dirty(false);
        onExit();
      }}
    />
  );
  const offlineControls =
    user && !guest && rootFile ? (
      <SpaceOfflineActions
        key={rootFile.id}
        user={user}
        root={rootFile}
        item={selection.item}
        saved={!dirty && fresh && connection === 'online'}
        onOpen={(id) => {
          go(spaceHref(rootFile.id, { kind: 'page', id }));
        }}
      />
    ) : null;
  const shell = (
    <SpaceShell
      user={guest ? undefined : user}
      connection={connection}
      documentOpen={Boolean(visiblePage)}
      onExit={exit}
      onProfile={profile}
      navigation={navigationView}
      navigationButton={pagesButton}
    >
      {route.kind === 'index' && !guest ? (
        <>
          <div className="space-index-heading">
            <h1>Spaces</h1>
            {bootstrap && (
              <Button
                primary
                disabled={busy || unavailableManagement}
                onClick={() => {
                  setActionError('');
                  setAction({ mode: 'root' });
                }}
              >
                New Space
              </Button>
            )}
          </div>
          {bootstrap && (
            <ul className="space-list" aria-label="Your Spaces">
              {bootstrap.spaces.map(({ space, access }) => (
                <li key={space.id}>
                  <a
                    href={spaceHref(space.id)}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      go(spaceHref(space.id));
                    }}
                  >
                    <EntityIcon kind="space" size={32} />
                    <strong>{space.name}</strong>
                    {space.id === recent && <span>Recent</span>}
                    <span>{accessLabel(access)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
          {bootstrap && !bootstrap.spaces.length && (
            <div className="space-empty">
              <EntityIcon kind="space" size={52} />
              <h2>Your first Space</h2>
              <p>Keep related Docs, Sheets and folders together. Choose New Space to begin.</p>
            </div>
          )}
        </>
      ) : (
        <>
          <header className="space-page-header" hidden={Boolean(visiblePage)}>
            {trashView ? (
              <ProfileIcon icon="lucide:trash-2" size={32} />
            ) : (
              <EntityIcon kind="space" size={32} />
            )}
            <div className="space-page-identity">
              <p>{currentTree ? 'Space · ' + currentTree.space.name : 'Space'}</p>
              <h1>
                {trashView
                  ? 'Space Trash'
                  : (selection.item?.name ??
                    (denied ? 'Space unavailable' : (currentTree?.space.name ?? 'Open a Space')))}
              </h1>
            </div>
            {currentTree?.access === 'viewer' && <span className="space-access">View only</span>}
            {currentTree?.access === 'admin' && <span className="space-access">File admin</span>}
            {currentTree?.access === 'editor' && <span className="space-access">Can edit</span>}
            {guest && <span className="space-access">Guest</span>}
            {!visiblePage && user && !guest && canAdminister(rootFile?.access) && rootControls}
          </header>
          {user &&
            !guest &&
            rootFile &&
            !trashView &&
            (!visiblePage || offlineOpen) &&
            (visiblePage ? (
              <Modal
                title="Offline copies"
                icon="info"
                open
                onOpenChange={() => setOfflineOpen(false)}
              >
                {offlineControls}
              </Modal>
            ) : (
              offlineControls
            ))}
        </>
      )}
      {loading && !currentTree && !bootstrap && (
        <p className="space-content" role="status">
          Loading Space…
        </p>
      )}
      {loadError && (
        <div className="space-error" role="alert">
          <p>{loadError}</p>
          <Button
            disabled={busy}
            onClick={() => {
              setOperationError('');
              void refresh.current(true);
            }}
          >
            Try again
          </Button>
          {denied && !guest && <Button onClick={exit}>My files</Button>}
          {denied && dirty && <p>Copy unsaved changes before leaving.</p>}
        </div>
      )}
      {!trashView && !action && operationError && (
        <p className="space-error" role="alert">
          {operationError}
        </p>
      )}
      {route.kind === 'unavailable' && (
        <div className="space-empty">
          <h2>This Space link is not available.</h2>
          {!guest && <Button onClick={exit}>My files</Button>}
        </div>
      )}
      {connection === 'offline' && currentTree && !trashView && (
        <p className="space-notice" role="status">
          Reconnect to add, move or recover pages. Keep this tab open if changes are pending.
        </p>
      )}
      {!trashView && notice && (
        <p className="space-notice" role="status">
          {notice}
        </p>
      )}
      {currentTree &&
        trashView &&
        (canEdit && !guest ? (
          <SpaceTrash
            listing={
              trash && {
                ...trash,
                access:
                  currentTree.access === 'owner' && trash.access === 'owner' ? 'owner' : 'editor',
              }
            }
            spaceName={currentTree.space.name}
            disabled={unavailableManagement}
            busy={busy}
            error={operationError || trashError}
            notice={notice}
            preview={preview}
            onReload={() => {
              setOperationError('');
              void refresh.current(true);
            }}
            onRestore={restore}
            onPreviewDelete={previewDelete}
            onCancelDelete={() => setPreview(null)}
            onConfirmDelete={confirmDelete}
          />
        ) : (
          <p className="space-content" role="alert">
            Space Trash is available to account editors.
          </p>
        ))}
      {selection.missing && !loading && (
        <p className="space-notice" role="alert">
          This page is not available.{' '}
          {dirty ? 'Copy unsaved changes before leaving.' : 'Choose another page from Pages.'}
        </p>
      )}
      {visiblePage && (
        <div className="space-native-editor rd-native-editor" key={editorKey!}>
          {renderEditor({
            ...visiblePage,
            saveStatusTarget: null,
            onDirty,
            onConnectionState: publishConnection,
          })}
        </div>
      )}
      {currentTree && !trashView && !selection.item && !selection.missing && !loading && (
        <div className="space-empty">
          <EntityIcon kind="space" size={52} />
          <h2>{currentTree.items.length ? 'Choose a page' : 'This Space is empty'}</h2>
          <p>
            {canEdit
              ? 'Choose Add page to create a Doc, Sheet or folder.'
              : 'Pages will appear here when an editor adds them.'}
          </p>
        </div>
      )}
      {action && (
        <SpaceItemDialog
          key={
            action.mode + ('item' in action ? action.item.id : 'kind' in action ? action.kind : '')
          }
          action={action}
          tree={currentTree}
          folders={bootstrap?.folders}
          busy={busy}
          disabled={unavailableManagement || (action.mode !== 'root' && !canEdit)}
          error={actionError}
          onCancel={() => {
            setAction(null);
            setActionError('');
          }}
          onSubmit={submit}
        />
      )}
      {visiblePage &&
        rootAction &&
        user &&
        !guest &&
        canAdminister(rootFile?.access) &&
        rootControls}
    </SpaceShell>
  );
  // A guest with no loaded tree receives no Space identity or account navigation.
  // GuestApp disposes even dirty guest editors on authoritative revocation.
  // Account draft recovery remains a separate, unchanged boundary.
  if (guest && !currentTree && !visiblePage)
    return (
      <AccessState
        kind={
          denied
            ? 'revoked'
            : route.kind === 'unavailable'
              ? 'missing'
              : loadError
                ? 'offline'
                : 'loading'
        }
        onRetry={() => void refresh.current(true)}
      />
    );
  return visiblePage ? (
    <EditorFrame
      documentKey={editorKey!}
      name={denied ? 'Space unavailable' : visiblePage.item.name}
      onRename={
        !guest && !denied && selection.item && canAdminister(currentTree?.access) && canEdit
          ? async (name) => {
              const renamed = await mutate(
                (signal) =>
                  spacesRequest<{ item: SpaceNode }>(
                    `/${visiblePage.spaceId}/items/${visiblePage.item.id}`,
                    { method: 'PATCH', body: { name }, signal },
                  ),
                () => {},
              );
              if (!renamed)
                throw new Error(
                  'Could not rename this page. Check the connection and your access.',
                );
            }
          : undefined
      }
      contextLabel={currentTree ? `Space · ${currentTree.space.name}` : undefined}
      connection={connection}
      guest={Boolean(guest)}
      access={
        denied || selection.missing
          ? 'Access changed'
          : guest
            ? canEdit
              ? 'Guest editor'
              : 'View only'
            : currentTree?.access === 'owner'
              ? undefined
              : currentTree?.access === 'viewer'
                ? 'View only'
                : currentTree?.access === 'admin'
                  ? 'File admin'
                  : 'Can edit'
      }
      onBack={user && !guest ? exit : undefined}
      backLabel="My files"
      actions={[
        ...(user && !guest && canAdminister(rootFile?.access)
          ? (['share', 'rename', 'move', 'trash'] as const).map((mode) => ({
              label: {
                share: 'Share…',
                rename: 'Rename Space…',
                move: 'Move…',
                trash: 'Move to Trash',
              }[mode],
              onClick: (trigger?: HTMLButtonElement | null) => {
                rootActionTrigger.current = trigger ?? null;
                setRootAction(mode);
              },
              destructive: mode === 'trash',
            }))
          : []),
        ...(user && !guest
          ? [{ label: 'Offline copies', onClick: () => setOfflineOpen(true) }]
          : []),
      ]}
    >
      {shell}
    </EditorFrame>
  ) : (
    shell
  );
}
