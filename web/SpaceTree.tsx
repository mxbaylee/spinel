import { ItemIcon } from './Appearance.tsx';
import { useEffect, useId, useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { SpaceNode, SpaceRoot } from '../src/shared/spaces.ts';
import { ProfileIcon } from '../src/profile/ProfileIcon.tsx';
import { ActionMenu } from '../src/ui/redesign/Controls.tsx';
import { spaceHref, visibleSpaceRows } from './spaceNavigation.ts';

export type SpaceTreeAction =
  | { mode: 'appearance'; item: SpaceNode }
  | { mode: 'rename'; item: SpaceNode }
  | { mode: 'move'; item: SpaceNode }
  | { mode: 'trash'; item: SpaceNode };

export function SpaceTree({
  space,
  items,
  selectedId,
  expandedIds,
  onToggle,
  onOpen,
  onAction,
  canEdit,
  disabled = false,
}: {
  space: SpaceRoot;
  items: SpaceNode[];
  selectedId: string | null;
  expandedIds: ReadonlySet<string>;
  onToggle(id: string): void;
  onOpen(id: string): boolean;
  onAction(action: SpaceTreeAction, trigger?: HTMLButtonElement): void;
  canEdit: boolean;
  disabled?: boolean;
}) {
  const prefix = useId();
  const scroll = useRef<HTMLDivElement>(null);
  const scrolled = useRef('');
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const rows = useMemo(
    () => visibleSpaceRows(space.id, items, expandedIds),
    [space.id, items, expandedIds],
  );
  useEffect(() => {
    const container = scroll.current;
    const row = rows.find(({ item }) => item.id === selectedId);
    if (!container || !container.clientWidth || !row) return;
    const key = `${selectedId}/${row.item.parentId}/${row.depth}/${canEdit}`;
    if (scrolled.current === key) return;
    const target = container.querySelector<HTMLElement>('[aria-current="page"]');
    if (!target) return;
    const bounds = container.getBoundingClientRect();
    const selected = target.getBoundingClientRect();
    const action = canEdit
      ? target.parentElement?.querySelector<HTMLElement>('[aria-haspopup="menu"]')
      : null;
    const actionBounds = action?.getBoundingClientRect();
    const right = Math.max(selected.right, actionBounds?.right ?? selected.right);
    const top = Math.min(selected.top, actionBounds?.top ?? selected.top);
    const bottom = Math.max(selected.bottom, actionBounds?.bottom ?? selected.bottom);
    // Reveal the deep selection and its actions, not the wide indentation before it.
    // Keep this within the tree's own scroller so the editor never moves.
    if (selected.left < bounds.left) container.scrollLeft -= bounds.left - selected.left;
    else if (right > bounds.right) container.scrollLeft += right - bounds.right;
    if (top < bounds.top) container.scrollTop -= bounds.top - top;
    else if (bottom > bounds.bottom) container.scrollTop += bottom - bounds.bottom;
    scrolled.current = key;
  }, [rows, selectedId, canEdit]);
  return (
    <div
      ref={scroll}
      className="space-tree-scroll"
      role="region"
      aria-label="Space pages"
      tabIndex={0}
    >
      <ul className="space-tree">
        {rows.map(({ item, depth, childCount }) => {
          const expanded = expandedIds.has(item.id);
          const context = prefix + '-' + item.id;
          const parent = byId.get(item.parentId)?.name ?? space.name;
          const icon = <ItemIcon {...item} size={18} />;
          return (
            <li key={item.id} aria-label={item.name}>
              <div className="space-tree-row" style={{ '--space-depth': depth } as CSSProperties}>
                {childCount > 0 ? (
                  <button
                    className="space-disclosure"
                    type="button"
                    aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.name}`}
                    aria-expanded={expanded}
                    onClick={() => onToggle(item.id)}
                  >
                    <ProfileIcon
                      icon={expanded ? 'lucide:chevron-down' : 'lucide:chevron-right'}
                      size={16}
                    />
                  </button>
                ) : (
                  <span className="space-disclosure-placeholder" aria-hidden="true" />
                )}
                {item.kind === 'folder' ? (
                  <button
                    className="space-page-link"
                    type="button"
                    title={item.name}
                    aria-expanded={expanded}
                    aria-describedby={context}
                    onClick={() => onToggle(item.id)}
                  >
                    {icon}
                    <span>{item.name}</span>
                  </button>
                ) : (
                  <a
                    className="space-page-link"
                    href={spaceHref(space.id, { kind: 'page', id: item.id })}
                    title={item.name}
                    aria-describedby={context}
                    aria-current={selectedId === item.id ? 'page' : undefined}
                    onClick={(event) => {
                      if (
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey ||
                        event.altKey ||
                        event.button !== 0
                      )
                        return;
                      event.preventDefault();
                      onOpen(item.id);
                    }}
                  >
                    {icon}
                    <span>{item.name}</span>
                  </a>
                )}
                <span id={context} className="space-sr-only">
                  {item.kind === 'folder' ? 'Folder' : item.kind === 'doc' ? 'Doc' : 'Sheet'} in{' '}
                  {parent}. Level {depth + 1}, position {item.position + 1}.
                  {childCount ? ` ${childCount} children.` : ''}
                </span>
                {canEdit && (
                  <ActionMenu
                    label={`More actions for ${item.name}`}
                    actions={[
                      {
                        label: 'Appearance…',
                        disabled: !canEdit || disabled,
                        onClick: (trigger) =>
                          onAction({ mode: 'appearance', item }, trigger ?? undefined),
                      },
                      {
                        label: 'Rename',
                        disabled,
                        onClick: () => onAction({ mode: 'rename', item }),
                      },
                      {
                        label: 'Move or reorder',
                        disabled,
                        onClick: () => onAction({ mode: 'move', item }),
                      },
                      {
                        label: 'Trash',
                        disabled,
                        destructive: true,
                        onClick: () => onAction({ mode: 'trash', item }),
                      },
                    ]}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!rows.length && <p className="space-tree-empty">No pages yet.</p>}
    </div>
  );
}
