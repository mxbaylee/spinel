import { useId, useMemo, useState } from 'react';
import type { SpaceBootstrap, SpaceNode, SpaceTreeData } from '../src/shared/spaces.ts';
import type { ItemKind } from '../src/shared/workspace.ts';
import { Button, Choice, Modal } from '../src/ui/redesign/Controls.tsx';
import { spaceSubtree } from './spaceNavigation.ts';

export type SpaceDialogAction =
  | { mode: 'root' }
  | { mode: 'add'; kind: ItemKind }
  | { mode: 'rename'; item: SpaceNode }
  | { mode: 'move'; item: SpaceNode }
  | { mode: 'trash'; item: SpaceNode };
export type SpaceDialogValue = {
  name?: string;
  kind?: ItemKind;
  parentId?: string | null;
  position?: number;
};

export function SpaceItemDialog({
  action,
  tree,
  folders = [],
  busy,
  disabled,
  error,
  onCancel,
  onSubmit,
}: {
  action: SpaceDialogAction;
  tree: SpaceTreeData | null;
  folders?: SpaceBootstrap['folders'];
  busy: boolean;
  disabled: boolean;
  error: string;
  onCancel(): void;
  onSubmit(value: SpaceDialogValue): void;
}) {
  const item = 'item' in action ? action.item : null;
  const positionDescription = useId();
  const [name, setName] = useState(item?.name ?? '');
  const [parentId, setParentId] = useState(
    action.mode === 'root' ? '' : (item?.parentId ?? tree?.space.id ?? ''),
  );
  const [position, setPosition] = useState(String((item?.position ?? 0) + 1));
  const excluded = useMemo(
    () => (item && tree ? spaceSubtree(tree.items, item.id) : new Set<string>()),
    [item, tree],
  );
  const parents = new Map((tree?.items ?? folders).map((entry) => [entry.id, entry]));
  function locationLabel(entry: { name: string; parentId: string | null }) {
    const names = [entry.name];
    let cursor = entry.parentId;
    // Keep each choice bounded even for a very deep tree. The full hierarchy
    // remains navigable in Pages; no node is excluded because of its depth.
    for (let depth = 0; depth < 2 && cursor && parents.has(cursor); depth++) {
      const parent = parents.get(cursor)!;
      names.unshift(parent.name);
      cursor = parent.parentId;
    }
    return (cursor && parents.has(cursor) ? '… / ' : '') + names.join(' / ');
  }
  const destinations =
    action.mode === 'root'
      ? [
          { value: '', label: 'My files' },
          ...folders.map((folder) => ({ value: folder.id, label: locationLabel(folder) })),
        ]
      : tree
        ? [
            { value: tree.space.id, label: tree.space.name + ' · Space root' },
            ...tree.items
              .filter((entry) => !excluded.has(entry.id))
              .map((entry) => ({
                value: entry.id,
                label:
                  locationLabel(entry) +
                  ` · ${entry.kind === 'doc' ? 'Doc' : entry.kind === 'sheet' ? 'Sheet' : 'Folder'} ${entry.position + 1}`,
              })),
          ]
        : [];
  const maximum =
    (tree?.items.filter((entry) => entry.parentId === parentId && entry.id !== item?.id).length ??
      0) + 1;
  const title =
    action.mode === 'root'
      ? 'New Space'
      : action.mode === 'add'
        ? 'New ' + (action.kind === 'doc' ? 'Doc' : action.kind === 'sheet' ? 'Sheet' : 'folder')
        : `${action.mode === 'move' ? 'Move or reorder' : action.mode === 'trash' ? 'Trash' : 'Rename'} ${item!.name}`;
  const submitLabel =
    action.mode === 'root' || action.mode === 'add'
      ? 'Create'
      : action.mode === 'trash'
        ? 'Move to Trash'
        : 'Save';
  return (
    <Modal
      title={title}
      icon={
        action.mode === 'root'
          ? 'space'
          : action.mode === 'add'
            ? action.kind
            : action.mode === 'trash'
              ? 'trash'
              : 'folder'
      }
      open
      dismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || disabled) return;
          onSubmit(
            action.mode === 'trash'
              ? {}
              : action.mode === 'move'
                ? { parentId, position: Number(position) - 1 }
                : action.mode === 'rename'
                  ? { name }
                  : action.mode === 'root'
                    ? { name, parentId: parentId || null }
                    : { name, kind: action.kind, parentId },
          );
        }}
      >
        <div className="space-form-fields">
          {action.mode === 'trash' ? (
            <p>
              Move {item!.name}
              {excluded.size > 1 ? ` and its ${excluded.size - 1} descendants` : ''} to Space Trash?{' '}
              An account editor can restore the complete subtree.
            </p>
          ) : (
            action.mode !== 'move' && (
              <label>
                Name
                <input
                  autoFocus
                  required
                  maxLength={120}
                  value={name}
                  disabled={busy || disabled}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
            )
          )}
          {(action.mode === 'root' || action.mode === 'add' || action.mode === 'move') && (
            <Choice
              label={action.mode === 'root' ? 'Folder' : 'Parent page or folder'}
              value={parentId}
              disabled={busy || disabled}
              options={destinations}
              onChange={(value) => {
                setParentId(value);
                setPosition('1');
              }}
            />
          )}
          {action.mode === 'move' && (
            <div>
              <label>
                Position
                <input
                  type="number"
                  required
                  min={1}
                  max={maximum}
                  step={1}
                  value={position}
                  aria-describedby={positionDescription}
                  disabled={busy || disabled}
                  onChange={(event) => setPosition(event.target.value)}
                />
              </label>
              <p id={positionDescription} className="sp-muted">
                Position 1 is first. The destination has {maximum - 1} other items.
              </p>
            </div>
          )}
          {disabled && <p role="status">Reconnect with edit access to change this Space.</p>}
          {error && <p role="alert">{error}</p>}
        </div>
        <div className="sp-actions">
          <Button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            primary
            disabled={
              busy ||
              disabled ||
              (action.mode !== 'move' && action.mode !== 'trash' && !name.trim())
            }
          >
            {busy ? 'Saving…' : submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
