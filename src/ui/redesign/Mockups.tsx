/** SPN-047 review prototypes. No production routes, network calls or document writes. */
import { createContext, useContext, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Tooltip } from '@base-ui/react/tooltip';
import { GemLogo, replayGemWiggle } from '../GemLogo.tsx';
import { EntityIcon } from '../EntityIcon.tsx';
import { ProfileIcon } from '../../profile/ProfileIcon.tsx';
import { defaultProfile } from '../../profile/profile.ts';
import type { Profile } from '../../profile/profile.ts';
import { IconPicker } from '../../../web/ProfileSettings.tsx';
import { fillPresets } from '../palette.ts';
import { getPreference, setPreference, watchTheme } from '../theme.ts';
import { ActionMenu, Button, Choice, DetailsPopover, Modal } from './Controls.tsx';
import { AppearanceChoice, ThemeMenu } from './ThemeMenu.tsx';
export { AppearanceChoice, ThemeMenu } from './ThemeMenu.tsx';
import './mockups.css';
import { LoadingReview } from './LoadingReview.tsx';
import { TokenManager } from './TokenManager.tsx';
import { ConnectionsReview } from './ConnectionsReview.tsx';
import { TagsReview, TagLabelsReview } from './TagsReview.tsx';
import { ImportDialog } from './ImportReview.tsx';
import { VersionNamesReview } from './VersionNamesReview.tsx';
import { PresenceReview } from './PresenceReview.tsx';
import { FormulaReview, type FormulaReviewState } from './FormulaReview.tsx';
import { SharingReview as SharingContent } from './SharingReview.tsx';
import type { SharingState } from './SharingReview.tsx';
import type { Collaborator } from '../../../web/Collaborators.tsx';

type GlyphName =
  | 'files'
  | 'search'
  | 'folder'
  | 'shared'
  | 'trash'
  | 'forward'
  | 'back'
  | 'menu'
  | 'sun'
  | 'check'
  | 'shield'
  | 'download'
  | 'upload'
  | 'history'
  | 'formula'
  | 'network'
  | 'network-off'
  | 'list'
  | 'monitor'
  | 'moon';
const paths: Record<GlyphName, string> = {
  monitor: 'M3 3h18v14H3z M8 21h8 M10 17v4 M14 17v4',
  moon: 'M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10 M18 2v6 M15 5h6',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
  files: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
  folder: 'M3 6h7l2 3h9v11H3z',
  shared:
    'M8 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M2 20v-3a6 6 0 0 1 12 0v3 M16 5a3 3 0 0 1 0 6 M17 14a5 5 0 0 1 5 5',
  trash: 'M4 6h16 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7',
  back: 'M15 5l-7 7 7 7',
  forward: 'M9 5l7 7-7 7',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10 M12 1v2 M12 21v2 M1 12h2 M21 12h2 M4 4l2 2 M18 18l2 2 M4 20l2-2 M18 6l2-2',
  check: 'M5 12l4 4L19 6',
  shield: 'M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z',
  network: 'M2 8q10-8 20 0 M5 12q7-6 14 0 M8 16q4-4 8 0 M12 20h.01',
  'network-off': 'M2 8q10-8 20 0 M5 12q7-6 14 0 M8 16q4-4 8 0 M12 20h.01 M3 3l18 18',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
  upload: 'M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5',
  history: 'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l4 2',
  formula: 'M15 4h-3l-4 16H5 M6 10h9 M16 14l5 6 M21 14l-5 6',
};
function Glyph({ name }: { name: GlyphName }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
// Predictable identity without stored metadata; identical names intentionally share a cue.
// A rename may change this default. SPN-086 adds an explicit, persistent choice later.
function filenameEmoji(name: string): string {
  const choices = ['🌿', '🌻', '🍂', '🍋', '🪻', '🌷', '🪴', '🍄', '🌵', '🍀', '🌺', '🪷'];
  let hash = 0;
  for (const character of name.normalize('NFC'))
    hash = (Math.imul(hash, 31) + character.codePointAt(0)!) >>> 0;
  return choices[hash % choices.length]!;
}
function FileIdentity({
  kind,
  emoji,
  size = 32,
}: {
  kind: 'doc' | 'sheet' | 'space';
  emoji?: string;
  size?: number;
}) {
  return emoji ? (
    <span className="rd-file-emoji" style={{ fontSize: size }} aria-hidden="true">
      {emoji}
    </span>
  ) : (
    <EntityIcon kind={kind} size={size} />
  );
}
const sampleProfile = defaultProfile('Alex Baylee');
export const ReviewProfileContext = createContext<{
  profile: Profile;
  save: (profile: Profile) => void;
}>({ profile: sampleProfile, save: () => {} });
function Avatar({ children, color }: { children?: ReactNode; color?: string }) {
  const { profile } = useContext(ReviewProfileContext);
  const fill = color ?? profile.color;
  return (
    <span
      className="rd-avatar"
      style={{ background: `var(--fill-${fill}-bg)`, color: `var(--fill-${fill}-fg)` }}
    >
      {children ?? <ProfileIcon icon={profile.icon} />}
    </span>
  );
}
function NetworkStatus({ offline = false }: { offline?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip.Root open={open} onOpenChange={setOpen}>
      <Tooltip.Trigger
        className="rd-network-trigger"
        aria-label={offline ? 'Offline — not connected to Spinel' : 'Online — connected to Spinel'}
        delay={200}
        closeOnClick={false}
        onPointerDown={(event) => {
          if (event.pointerType === 'touch') setOpen(true);
        }}
      >
        <Glyph name={offline ? 'network-off' : 'network'} />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner className="rd-tooltip-positioner" side="right" sideOffset={8}>
          <Tooltip.Popup className="sp-ui rd-network-tooltip">
            {offline
              ? 'You are offline. Open files may have changes waiting to sync. Check their save status before closing.'
              : 'Connected to Spinel. Open save status for details about this document.'}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
export type SpaceEntry = {
  name: string;
  kind: 'doc' | 'sheet' | 'folder';
  children?: SpaceEntry[];
};
const spacePages: SpaceEntry[] = [
  { name: 'Overview', kind: 'doc' },
  { name: 'Budget', kind: 'sheet' },
  { name: 'Places to stay', kind: 'doc' },
  {
    name: 'Weekend trip',
    kind: 'doc',
    children: [
      { name: 'Trip costs', kind: 'sheet' },
      { name: 'Packing list', kind: 'doc' },
    ],
  },
  { name: 'Reference', kind: 'folder', children: [{ name: 'Reservations', kind: 'doc' }] },
];
export function SpaceTree({
  entries = spacePages,
  selected,
  onSelect,
  onAction,
}: {
  entries?: SpaceEntry[];
  selected: string;
  onSelect: (name: string) => void;
  onAction?: (action: string) => void;
}) {
  return (
    <div className="rd-space-tree-scroll" role="region" aria-label="Space pages" tabIndex={0}>
      <ul className="rd-space-tree">
        {entries.map((entry) => (
          <SpaceBranch
            key={entry.name}
            entry={entry}
            selected={selected}
            onSelect={onSelect}
            onAction={onAction}
          />
        ))}
      </ul>
    </div>
  );
}
function SpaceBranch({
  entry,
  selected,
  onSelect,
  onAction,
}: {
  entry: SpaceEntry;
  selected: string;
  onSelect: (name: string) => void;
  onAction?: (action: string) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <li>
      <div className="rd-space-node">
        {entry.children ? (
          <button
            className="rd-space-toggle"
            aria-label={`${open ? 'Collapse' : 'Expand'} ${entry.name}`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <span aria-hidden="true">{open ? '⌄' : '›'}</span>
          </button>
        ) : (
          <span className="rd-space-toggle-placeholder" aria-hidden="true" />
        )}
        <button
          className="rd-nav-item"
          aria-label={entry.name}
          title={entry.name}
          aria-current={entry.kind !== 'folder' && selected === entry.name ? 'page' : undefined}
          aria-expanded={entry.kind === 'folder' ? open : undefined}
          onClick={() => (entry.kind === 'folder' ? setOpen(!open) : onSelect(entry.name))}
        >
          {entry.kind === 'folder' ? (
            <Glyph name="folder" />
          ) : (
            <EntityIcon kind={entry.kind} size={18} />
          )}
          <span>{entry.name}</span>
        </button>
        {onAction && (
          <ActionMenu
            label={`${entry.kind === 'folder' ? 'Folder' : 'Page'} actions for ${entry.name}`}
            actions={['Rename', 'Move or reorder', 'Trash'].map((label) => ({
              label,
              destructive: label === 'Trash',
              onClick: () => onAction(`${label}: ${entry.name}`),
            }))}
          />
        )}
      </div>
      {entry.children && open && (
        <ul>
          {entry.children.map((child) => (
            <SpaceBranch
              key={child.name}
              entry={child}
              selected={selected}
              onSelect={onSelect}
              onAction={onAction}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
function Sidebar({
  space = false,
  spaceEntries,
  selected,
  onSelect,
  guest = false,
  canEdit = true,
  onCollapse,
  offline = false,
  appearanceStyle,
}: {
  appearanceStyle?: CSSProperties;
  spaceEntries?: SpaceEntry[];
  offline?: boolean;
  onCollapse?: () => void;
  canEdit?: boolean;
  space?: boolean;
  selected: string;
  onSelect: (view: string) => void;
  guest?: boolean;
}) {
  const { profile } = useContext(ReviewProfileContext);
  const [action, setAction] = useState('');
  const [destination, setDestination] = useState('root');
  const groups: { title: string; items: [string, GlyphName][] }[] = [
    {
      title: 'WORKSPACE',
      items: [
        ['My files', 'files'],
        ['Shared with me', 'shared'],
      ],
    },
  ];
  return (
    <nav
      className={`rd-sidebar ${space ? 'rd-space-sidebar' : ''} ${appearanceStyle ? 'rd-appearance-navigation' : ''}`}
      style={appearanceStyle}
      aria-label={space ? 'Space contents' : 'Files'}
    >
      {onCollapse && !space && (
        <div className="rd-sidebar-brand">
          {guest ? (
            <span className="rd-brand">
              <span className="rd-gem-wiggle">
                <GemLogo />
              </span>
            </span>
          ) : (
            <button
              className="rd-brand rd-brand-button"
              aria-label="Spinel home"
              onClick={(event) => {
                replayGemWiggle(event.currentTarget);
                onSelect('My files');
              }}
            >
              <span className="rd-gem-wiggle">
                <GemLogo />
              </span>
            </button>
          )}
          <NetworkStatus offline={offline} />
          <Button aria-label="Collapse navigation" onClick={onCollapse}>
            <Glyph name="back" />
          </Button>
        </div>
      )}
      {space ? (
        <section className="rd-space-pages">
          <div className="rd-space-nav-heading">
            <h2>Autumn plans</h2>
            {onCollapse && (
              <Button aria-label="Collapse navigation" onClick={onCollapse}>
                <Glyph name="back" />
              </Button>
            )}
          </div>
          <SpaceTree
            entries={spaceEntries}
            selected={selected}
            onSelect={onSelect}
            onAction={canEdit ? setAction : undefined}
          />
        </section>
      ) : (
        groups.map((group) => (
          <section key={group.title}>
            {group.items.map(([label, glyph]) => (
              <button
                key={label}
                className="rd-nav-item"
                aria-current={selected === label ? 'page' : undefined}
                onClick={() => onSelect(label)}
              >
                <Glyph name={glyph} />
                {label}
              </button>
            ))}
          </section>
        ))
      )}
      {space && canEdit && (
        <ActionMenu
          label="Add page"
          actions={['Doc', 'Sheet', 'Folder'].map((x) => ({
            icon:
              x === 'Folder' ? (
                <Glyph name="folder" />
              ) : (
                <EntityIcon kind={x === 'Doc' ? 'doc' : 'sheet'} size={16} />
              ),
            label: x,
            onClick: () => setAction(`New ${x}`),
          }))}
        >
          ＋ Add page
        </ActionMenu>
      )}
      <Modal
        icon={action.startsWith('Trash') ? 'trash' : 'folder'}
        title={action || 'Page actions'}
        description="This change stays within the current Space."
        open={Boolean(action)}
        onOpenChange={(open) => {
          if (!open) setAction('');
        }}
      >
        {action.startsWith('Move') ? (
          <>
            <Choice
              label="Parent page"
              value={destination}
              onChange={setDestination}
              options={[
                { value: 'root', label: 'Space root' },
                { value: 'weekend', label: 'Weekend trip' },
              ]}
            />
            <label>
              Position
              <input type="number" min="1" defaultValue="1" />
            </label>
          </>
        ) : action.startsWith('Trash') ? (
          <p>
            {guest
              ? 'An account editor can restore this page from Space trash.'
              : 'The page can be recovered from Space trash.'}
          </p>
        ) : (
          <label>
            Page name
            <input defaultValue={selected} />
          </label>
        )}
        <div className="sp-actions">
          <Button onClick={() => setAction('')}>Cancel</Button>
          <Button primary onClick={() => setAction('')}>
            Confirm
          </Button>
        </div>
      </Modal>
      {!guest && ((onCollapse && !space) || (space && canEdit)) && (
        <div className="rd-sidebar-bottom">
          {onCollapse && !guest && !space && (
            <div className="rd-sidebar-utilities">
              <div className="rd-appearance-row">
                <ThemeMenu />
              </div>
              <Button
                className="rd-profile-control"
                aria-label={`${profile.name} — Profile settings`}
                title={`${profile.name} — Profile settings`}
                onClick={() => onSelect('Your profile')}
              >
                <Avatar />
                <span className="rd-profile-name">{profile.name}</span>
              </Button>
            </div>
          )}
          {space && canEdit && (
            <button className="rd-nav-item" onClick={() => onSelect('Trash')}>
              <Glyph name="trash" />
              {space ? 'Space trash' : 'Trash'}
            </button>
          )}
        </div>
      )}
    </nav>
  );
}
function Shell({
  children,
  sidebar = false,
  space = false,
  spaceEntries,
  guest = false,
  operator = false,
  canEdit = true,
  selected = 'My files',
  onSelect = () => {},
  collapsed = false,
  compact = false,
  offline = false,
  accountAvatar,
  navigationAppearance,
}: {
  navigationAppearance?: CSSProperties;
  spaceEntries?: SpaceEntry[];
  accountAvatar?: ReactNode;
  offline?: boolean;
  children: ReactNode;
  collapsed?: boolean;
  compact?: boolean;
  sidebar?: boolean;
  space?: boolean;
  guest?: boolean;
  operator?: boolean;
  canEdit?: boolean;
  selected?: string;
  onSelect?: (view: string) => void;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const [nav, setNav] = useState(false);
  const [expanded, setExpanded] = useState(!collapsed);
  const setNavigation = (open: boolean) => {
    setExpanded(open);
    requestAnimationFrame(() =>
      shellRef.current
        ?.querySelector<HTMLButtonElement>(
          open
            ? 'button[aria-label="Collapse navigation"]'
            : guest
              ? '.rd-mobile-nav button'
              : space
                ? '.rd-space-pages-open'
                : '.rd-rail-button',
        )
        ?.focus(),
    );
  };
  return (
    <div
      ref={shellRef}
      className={`sp-ui rd-shell ${sidebar && expanded ? 'rd-with-sidebar' : ''} ${guest ? 'rd-guest' : ''} ${compact || space ? 'rd-compact-shell' : ''} ${space ? 'rd-space-shell' : ''} ${sidebar ? 'rd-has-navigation' : ''}`}
    >
      {!guest && (
        <aside className="rd-rail" aria-label="Global navigation">
          <button
            className="rd-brand rd-brand-button"
            aria-label={operator ? 'Spinel administration' : 'Spinel home'}
            onClick={(event) => {
              replayGemWiggle(event.currentTarget);
              onSelect('My files');
            }}
          >
            <span className="rd-gem-wiggle">
              <GemLogo />
            </span>
          </button>
          <NetworkStatus offline={offline} />
          {!space && (
            <button
              className="rd-rail-button"
              aria-label={sidebar ? 'Expand navigation' : operator ? 'Administration' : 'My files'}
              title={sidebar ? 'Expand navigation' : operator ? 'Administration' : 'My files'}
              aria-expanded={sidebar ? nav : undefined}
              onClick={() => {
                if (sidebar) {
                  if (window.matchMedia('(max-width: 900px)').matches) setNav(true);
                  else setNavigation(!expanded);
                } else onSelect('My files');
              }}
            >
              <Glyph name={sidebar ? 'forward' : operator ? 'shield' : 'files'} />
            </button>
          )}
          {space && (
            <button
              className="rd-rail-button"
              aria-label="My files"
              title="My files"
              onClick={() => onSelect('My files')}
            >
              <Glyph name="files" />
            </button>
          )}
          {sidebar && !space && (
            <nav className="rd-collapsed-destinations" aria-label="File shortcuts">
              {(
                [
                  ['My files', 'files'],
                  ['Shared with me', 'shared'],
                ] as [string, GlyphName][]
              ).map(([label, glyph]) => (
                <button
                  key={label}
                  className="rd-rail-button"
                  title={label}
                  aria-label={label}
                  aria-current={selected === label ? 'page' : undefined}
                  onClick={() => onSelect(label)}
                >
                  <Glyph name={glyph} />
                  <span className="rd-nav-tooltip" aria-hidden="true">
                    {label}
                  </span>
                </button>
              ))}
            </nav>
          )}
          <div className="rd-rail-bottom">
            <ThemeMenu />
            <button
              className="rd-rail-button rd-profile-control"
              aria-label="Your profile"
              onClick={() => onSelect('Your profile')}
            >
              {accountAvatar ?? <Avatar />}
            </button>
          </div>
        </aside>
      )}
      {sidebar && (
        <>
          {expanded && (
            <div className="rd-desktop-nav">
              <Sidebar
                spaceEntries={spaceEntries}
                onCollapse={() => setNavigation(false)}
                offline={offline}
                space={space}
                selected={selected}
                onSelect={onSelect}
                guest={guest}
                canEdit={canEdit}
              />
            </div>
          )}
          {guest && (
            <div className="rd-mobile-nav">
              <Button
                onClick={() => {
                  if (window.matchMedia('(max-width:900px)').matches) setNav(true);
                  else setNavigation(true);
                }}
              >
                <Glyph name="menu" />
                {space ? 'Pages' : 'Browse files'}
              </Button>
            </div>
          )}
          <Modal
            icon="folder"
            title={space ? 'Space contents' : 'Browse files'}
            open={nav}
            onOpenChange={setNav}
          >
            <Sidebar
              appearanceStyle={navigationAppearance}
              spaceEntries={spaceEntries}
              space={space}
              offline={offline}
              canEdit={canEdit}
              selected={selected}
              guest={guest}
              onSelect={(view) => {
                onSelect(view);
                setNav(false);
              }}
            />
          </Modal>
        </>
      )}
      <main className="rd-main">
        {space && !guest && (
          <div className="rd-space-local-navigation">
            <Button
              className="rd-space-pages-open sp-quiet"
              aria-label="Open Space contents"
              aria-expanded={nav}
              onClick={() => {
                if (window.matchMedia('(max-width: 900px)').matches) setNav(true);
                else setNavigation(true);
              }}
            >
              <Glyph name="menu" /> Pages
            </Button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
const folderTags: Record<string, string> = {
  Household: 'household',
  Work: 'work',
  Trips: 'travel',
};
export const files = [
  ...['Household', 'Work', 'Trips'].map((name) => ({
    name,
    kind: 'folder' as const,
    detail: 'Folder',
    access: 'owner' as const,
    date: 'Yesterday',
    tags: '',
  })),
  {
    name: 'Quarterly budget',
    kind: 'sheet' as const,
    detail: 'Shared · Can edit',
    access: 'editor' as const,
    date: '12 minutes ago',
    tags: 'household',
  },
  {
    name: 'Autumn plans',
    kind: 'space' as const,
    detail: 'Private',
    access: 'owner' as const,
    date: '1 hour ago',
    tags: 'travel',
  },
  {
    name: 'A few good recipes',
    kind: 'doc' as const,
    detail: 'Private',
    access: 'owner' as const,
    date: 'Yesterday',
    tags: '',
  },
  {
    name: 'Reading list',
    kind: 'sheet' as const,
    detail: 'Shared · View only',
    access: 'viewer' as const,
    date: 'Yesterday',
    tags: '',
  },
  {
    name: 'Notes for next week',
    kind: 'doc' as const,
    detail: 'Private',
    access: 'owner' as const,
    date: 'Oct 18',
    tags: 'work',
  },
].map((file) => {
  const folder = Object.entries(folderTags).find(([, tag]) => file.tags === tag)?.[0];
  return {
    ...file,
    id: `fixture-${file.name}`,
    parentId: folder ? `fixture-${folder}` : null,
    ownerName: file.access === 'owner' ? undefined : 'Alex Kim',
  };
});
export function DashboardMockup({
  state = 'populated',
  fileMutation = 'ready',
  collapsed = false,
  initialLayout = 'list',
  onOpen,
  onProfile,
}: {
  onOpen?: (file: {
    id: string;
    name: string;
    kind: 'doc' | 'sheet' | 'space';
    access: 'owner' | 'editor' | 'viewer';
    locationLabel?: string;
  }) => void;
  onProfile?: () => void;
  initialLayout?: 'list' | 'grid';
  collapsed?: boolean;
  fileMutation?:
    | 'ready'
    | 'create-pending'
    | 'create-error'
    | 'rename-pending'
    | 'rename-error'
    | 'move-pending'
    | 'move-error'
    | 'file-pending'
    | 'file-error';
  state?:
    | 'populated'
    | 'empty'
    | 'empty-trash'
    | 'empty-shared'
    | 'loading'
    | 'error'
    | 'search'
    | 'filtered'
    | 'no-results'
    | 'trash'
    | 'shared'
    | 'folder'
    | 'shared-loading'
    | 'shared-error'
    | 'shared-unknown-owner'
    | 'search-pending'
    | 'search-error'
    | 'local'
    | 'local-no-data'
    | 'local-folder'
    | 'trash-loading'
    | 'trash-error'
    | 'trash-empty-confirm'
    | 'trash-empty-pending'
    | 'trash-empty-error'
    | 'trash-restore-pending'
    | 'trash-restore-error'
    | 'trash-delete-pending'
    | 'trash-delete-error'
    | 'trash-expired';
}) {
  const deletedFixtures = files
    .filter((file) => file.access === 'owner' && file.kind !== 'folder')
    .map((file) => ({ ...file, id: `deleted-${file.id}`, name: `Old ${file.name}` }));
  const [items, setItems] = useState<
    {
      id: string;
      parentId: string | null;
      name: string;
      kind: 'doc' | 'sheet' | 'space' | 'folder';
      access: 'owner' | 'editor' | 'viewer';
      detail: string;
      date: string;
      tags: string;
      ownerName?: string;
    }[]
  >(
    state === 'empty' || state === 'local-no-data'
      ? []
      : [...files, ...(state === 'empty-trash' ? [] : deletedFixtures)].filter(
          (file) => state !== 'empty-shared' || file.access === 'owner',
        ),
  );
  const nextFileId = useRef(0);
  const [target, setTarget] = useState(
    state.startsWith('trash-')
      ? (deletedFixtures[0]?.id ?? '')
      : fileMutation.startsWith('file-')
        ? 'fixture-Quarterly budget'
        : fileMutation.startsWith('rename-') || fileMutation.startsWith('move-')
          ? 'fixture-Autumn plans'
          : '',
  );
  const [destination, setDestination] = useState(
    fileMutation === 'ready' ? 'fixture-Household' : 'fixture-Work',
  );
  const [view, setView] = useState(
    state.startsWith('trash') || state === 'empty-trash'
      ? 'Trash'
      : state.startsWith('shared') || state === 'empty-shared'
        ? 'Shared with me'
        : state === 'local-folder'
          ? 'fixture-Work'
          : state === 'folder'
            ? 'fixture-Household'
            : 'My files',
  );
  const [search, setSearch] = useState(
    state.startsWith('search') ? 'budget' : state === 'no-results' ? 'winter' : '',
  );
  const [notice, setNotice] = useState('');
  const [folderColors, setFolderColors] = useState<Record<string, string>>({});
  const [folderColorOpen, setFolderColorOpen] = useState(false);
  const [dialog, setDialog] = useState(
    state.startsWith('trash-empty-')
      ? 'Empty trash'
      : state.startsWith('trash-delete-')
        ? 'Delete permanently'
        : fileMutation.startsWith('create-')
          ? 'Doc'
          : fileMutation.startsWith('rename-')
            ? 'Rename…'
            : fileMutation.startsWith('move-')
              ? 'Move…'
              : fileMutation.startsWith('file-')
                ? 'File into folder'
                : '',
  );
  const [name, setName] = useState(
    fileMutation.startsWith('create-')
      ? 'Weekend notes'
      : fileMutation.startsWith('rename-')
        ? 'Autumn plans revised'
        : '',
  );
  const fileMutationPending = fileMutation.endsWith('-pending');
  const [fileMutationFailed, setFileMutationFailed] = useState(fileMutation.endsWith('-error'));
  const [kind, setKind] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(state === 'filtered');
  const [scope, setScope] = useState('all');
  const [tag, setTag] = useState(state === 'filtered' ? 'household' : '');
  const [personalTags, setPersonalTags] = useState<Record<string, string[]>>({});
  const tagsFor = (file: { id: string; tags: string }) =>
    personalTags[file.id] ?? (file.tags ? [file.tags] : []);
  const [modified, setModified] = useState('any');
  const hasStructuredFilters = Boolean(
    tag || scope !== 'all' || modified !== 'any' || kind !== 'all',
  );
  const hasFilters = Boolean(search || hasStructuredFilters);
  const clearFilters = () => {
    setSearch('');
    setTag('');
    setScope('all');
    setModified('any');
    setKind('all');
  };

  const [trashed, setTrashed] = useState<string[]>(
    state === 'empty' || state === 'empty-trash' ? [] : deletedFixtures.map((file) => file.id),
  );
  const trashBatches = useRef(new Map(deletedFixtures.map((file) => [file.id, file.id])));
  const nextTrashBatch = useRef(0);
  // Match owned hierarchy and deletion batches; a shared file's parent is only personal filing.
  const ownedSubtree = (id: string, include: (file: (typeof items)[number]) => boolean) => {
    const found = new Set<string>();
    const pending = [id];
    while (pending.length) {
      const next = pending.pop()!;
      const file = items.find((item) => item.id === next);
      if (!file || found.has(next) || file.access !== 'owner' || !include(file)) continue;
      found.add(next);
      pending.push(...items.filter((item) => item.parentId === next).map((item) => item.id));
    }
    return found;
  };
  const trashFile = (file: (typeof items)[number]) => {
    const subtree = ownedSubtree(file.id, (item) => !trashed.includes(item.id));
    const batch = `preview-trash-${nextTrashBatch.current++}`;
    for (const id of subtree) trashBatches.current.set(id, batch);
    setTrashed((current) => [...current, ...subtree]);
    setItems((current) =>
      current.map((item) =>
        item.access !== 'owner' && item.parentId && subtree.has(item.parentId)
          ? { ...item, parentId: null }
          : item,
      ),
    );
    setNotice(`${file.name}${subtree.size > 1 ? ' and its owned contents' : ''} moved to Trash.`);
  };
  const [retried, setRetried] = useState(false);
  const localMode = state.startsWith('local');
  const trashPending = state.startsWith('trash-') && state.endsWith('-pending');
  const [trashError, setTrashError] = useState(
    state.startsWith('trash-') && state.endsWith('-error') && state !== 'trash-error' ? state : '',
  );
  const downloaded = (id: string) =>
    ['fixture-Quarterly budget', 'fixture-Reading list'].includes(id);
  const recoveryExpired = (id: string) =>
    state === 'trash-expired' && id === deletedFixtures.at(-1)?.id;
  const openFile = (file: (typeof items)[number]) => {
    if (trashed.includes(file.id)) return;
    if (file.kind === 'folder') setView(file.id);
    else if (!localMode || downloaded(file.id)) {
      if (onOpen)
        onOpen({
          ...file,
          kind: file.kind,
          access: localMode ? 'viewer' : file.access,
          locationLabel:
            items.find(
              (parent) =>
                parent.id === file.parentId &&
                parent.kind === 'folder' &&
                !trashed.includes(parent.id),
            )?.name ?? 'My files',
        });
      else
        setNotice(
          localMode
            ? `Read-only sample of ${file.name}. No device storage was read.`
            : `Opening ${file.name}…`,
        );
    } else setNotice(`${file.name} needs a connection. It is not downloaded in this sample.`);
  };
  const changeTrash = (action: 'restore' | 'delete' | 'empty', id = target) => {
    if (trashPending || localMode || (action === 'restore' && recoveryExpired(id))) return;
    const title = items.find((file) => file.id === id)?.name ?? 'File';
    if (action === 'empty') {
      setItems((current) => current.filter((file) => !trashed.includes(file.id)));
      setTrashed([]);
      trashBatches.current.clear();
    } else {
      const batch = trashBatches.current.get(id);
      const subtree = ownedSubtree(
        id,
        (file) =>
          trashed.includes(file.id) &&
          (action === 'delete' || trashBatches.current.get(file.id) === batch),
      );
      setTrashed((current) => current.filter((value) => !subtree.has(value)));
      if (action === 'delete') {
        setItems((current) => current.filter((file) => !subtree.has(file.id)));
      } else {
        setItems((current) =>
          current.map((file) =>
            file.id === id &&
            !current.some(
              (parent) =>
                parent.id === file.parentId &&
                parent.kind === 'folder' &&
                parent.access === 'owner' &&
                !trashed.includes(parent.id),
            )
              ? { ...file, parentId: null }
              : file,
          ),
        );
      }
      for (const value of subtree) trashBatches.current.delete(value);
    }
    setTrashError('');
    setDialog('');
    setNotice(
      action === 'empty'
        ? 'Trash emptied in this preview.'
        : `${title} ${action === 'restore' ? 'restored' : 'deleted permanently'} in this preview.`,
    );
  };
  const [layout, setLayout] = useState(initialLayout);
  const currentFolder = items.find((item) => item.kind === 'folder' && item.id === view);
  const folderAncestors: { id: string; name: string }[] = [];
  const visitedAncestors = new Set<string>(currentFolder ? [currentFolder.id] : []);
  let ancestorId = currentFolder?.parentId;
  while (ancestorId && !visitedAncestors.has(ancestorId)) {
    visitedAncestors.add(ancestorId);
    const ancestor = items.find((item) => item.kind === 'folder' && item.id === ancestorId);
    if (!ancestor) break;
    folderAncestors.unshift({ id: ancestor.id, name: ancestor.name });
    ancestorId = ancestor.parentId;
  }
  const selectView = (next: string) => {
    if (next === 'Your profile' && onProfile) onProfile();
    else {
      const file = items.find((item) => item.id === next || item.name === next);
      if (file && file.kind !== 'folder') openFile(file);
      else setView(file ? (file.kind === 'folder' ? file.id : file.name) : next);
    }
  };
  if (view === 'Your profile') return <ProfileMockup onBack={() => setView('My files')} />;
  if (state === 'local-no-data')
    return (
      <Shell compact offline onSelect={selectView}>
        <div className="rd-empty">
          <h1>You are offline</h1>
          <h2>No saved files on this device</h2>
          <p>
            Connect to load your files. No saved list is available; this does not mean your
            workspace is empty.
          </p>
          <Button
            onClick={() =>
              setNotice('Still offline in this preview. No connection request was made.')
            }
          >
            Try again
          </Button>
          <p role="status">{notice}</p>
        </div>
      </Shell>
    );
  const rows = items.filter(
    (file) =>
      file.name.toLowerCase().includes(search.toLowerCase()) &&
      (kind === 'all' || file.kind === kind) &&
      (!tag ||
        tagsFor(file).some(
          (value) =>
            value.normalize('NFKC').toLowerCase() ===
            tag.trim().replace(/^#/, '').normalize('NFKC').toLowerCase(),
        )) &&
      (scope === 'all' ||
        (scope === 'shared' ? file.access !== 'owner' : file.access === 'owner')) &&
      (modified === 'any' || file.date.includes('ago')) &&
      (view === 'Trash' ? trashed.includes(file.id) : !trashed.includes(file.id)) &&
      (!items.some((item) => item.name === view && item.kind !== 'folder') || file.name === view) &&
      (view !== 'Shared with me' || file.access !== 'owner') &&
      (view !== 'Trash' || file.access === 'owner') &&
      (!currentFolder || file.parentId === currentFolder.id),
  );
  // A folder may never be moved into itself or any of its descendants.
  const isWithinTarget = (id: string): boolean => {
    const visited = new Set<string>();
    let current: string | null = id;
    while (current && !visited.has(current)) {
      if (current === target) return true;
      visited.add(current);
      current = items.find((item) => item.id === current)?.parentId ?? null;
    }
    return false;
  };
  const empty = rows.length === 0;
  const listLabel =
    view === 'Trash' ? 'trash' : view === 'Shared with me' ? 'shared files' : 'your files';
  const listingLoading =
    state === 'loading' ||
    (state === 'shared-loading' && view === 'Shared with me') ||
    (state === 'trash-loading' && view === 'Trash');
  const listingFailed =
    !retried &&
    (state === 'error' ||
      (state === 'shared-error' && view === 'Shared with me') ||
      (state === 'trash-error' && view === 'Trash'));
  const searchFailed = state === 'search-error' && hasFilters && !retried;
  const targetFile = items.find((item) => item.id === target);
  const targetName = targetFile?.name ?? 'this file';
  const creating = ['Doc', 'Sheet', 'Space', 'Folder'].includes(dialog);
  const dialogBusy = trashPending || fileMutationPending;
  const actionLabel = creating
    ? `Create ${dialog}`
    : dialog === 'Rename…'
      ? 'Rename'
      : dialog === 'Move…'
        ? 'Move'
        : dialog === 'File into folder'
          ? 'File into folder'
          : dialog === 'Empty trash'
            ? `Permanently delete ${trashed.length} files`
            : dialog === 'Delete permanently'
              ? 'Delete permanently'
              : 'Done';
  return (
    <Shell
      sidebar
      offline={localMode}
      collapsed={collapsed}
      selected={currentFolder?.name ?? view}
      onSelect={selectView}
    >
      <header className="rd-page-header rd-dashboard-header">
        <div>
          {view !== 'My files' && (
            <nav className="rd-file-breadcrumb" aria-label="Breadcrumb">
              <button onClick={() => setView('My files')}>My files</button>
              {folderAncestors.map((ancestor) => (
                <span key={ancestor.id} className="rd-breadcrumb-step">
                  <span aria-hidden="true">/</span>
                  <button onClick={() => setView(ancestor.id)}>{ancestor.name}</button>
                </span>
              ))}
            </nav>
          )}
          <div className="rd-folder-heading">
            {currentFolder && (
              <Button
                className="sp-quiet rd-folder-color-trigger"
                aria-label={`Change color for ${currentFolder.name}`}
                title={localMode ? 'Reconnect to change the folder color.' : 'Change folder color'}
                disabled={localMode || currentFolder.access !== 'owner'}
                style={{
                  color: folderColors[currentFolder.id]
                    ? `var(--fill-${folderColors[currentFolder.id]}-bg)`
                    : undefined,
                }}
                onClick={() => setFolderColorOpen(true)}
              >
                <Glyph name="folder" />
              </Button>
            )}
            <h1>{currentFolder?.name ?? view}</h1>
          </div>
        </div>
        {view !== 'Trash' && !localMode && (
          <div className="rd-header-actions">
            <ActionMenu
              label="New file"
              primary
              actions={['Doc', 'Sheet', 'Space', 'Folder', 'Import file…'].map((label) => ({
                label,
                icon:
                  label === 'Folder' ? (
                    <Glyph name="folder" />
                  ) : label === 'Import file…' ? (
                    <Glyph name="upload" />
                  ) : (
                    <EntityIcon kind={label.toLowerCase() as 'doc' | 'sheet' | 'space'} size={16} />
                  ),
                onClick: () => {
                  setName('');
                  setTarget('');
                  setDialog(label);
                },
              }))}
            >
              ＋ New <span aria-hidden="true">⌄</span>
            </ActionMenu>
          </div>
        )}
        {view === 'Trash' && !localMode && (
          <Button
            disabled={trashPending || !trashed.length || listingLoading || listingFailed}
            onClick={() => {
              setTrashError('');
              setDialog('Empty trash');
            }}
          >
            Empty trash
          </Button>
        )}
      </header>
      <div className="rd-content rd-dashboard-content">
        {localMode && (
          <p className="rd-banner" role="status">
            Offline · Files as of October 19, 2026 at 14:05 UTC. Downloaded documents open read-only
            until you reconnect. This is a sample saved list; the preview does not read device
            storage.
          </p>
        )}
        <div className="rd-list-tools">
          <label className="rd-search">
            <Glyph name="search" />
            <input
              aria-label="Search files"
              placeholder={
                view === 'My files' ? 'Search all files' : `Search ${currentFolder?.name ?? view}`
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>

          <Button aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
            Filters {filtersOpen ? '⌃' : '⌄'}
          </Button>
          <div className="rd-view-switch" role="group" aria-label="File layout">
            <Button
              aria-label="List view"
              aria-pressed={layout === 'list'}
              onClick={() => setLayout('list')}
            >
              <Glyph name="list" /> List
            </Button>
            <Button
              aria-label="Grid view"
              aria-pressed={layout === 'grid'}
              onClick={() => setLayout('grid')}
            >
              <Glyph name="files" /> Grid
            </Button>
          </div>
        </div>
        <div className="rd-filter-bar">
          {hasStructuredFilters && (
            <>
              <span className="sp-muted">
                {[
                  tag && `Tag: ${tag}`,
                  scope !== 'all' && scope,
                  modified !== 'any' && 'Edited today',
                  kind !== 'all' && kind,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <Button onClick={clearFilters}>Clear filters</Button>
            </>
          )}
        </div>
        {filtersOpen && (
          <div className="rd-advanced-filters">
            <Choice
              label="File type"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: 'All types' },
                { value: 'folder', label: 'Folders' },
                { value: 'doc', label: 'Docs' },
                { value: 'sheet', label: 'Sheets' },
                { value: 'space', label: 'Spaces' },
              ]}
            />
            <Choice
              label="Ownership"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all', label: 'Mine and shared' },
                { value: 'mine', label: 'Mine' },
                { value: 'shared', label: 'Shared with me' },
              ]}
            />
            <label>
              Tag
              <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Any tag" />
            </label>
            <Choice
              label="Last modified"
              value={modified}
              onChange={setModified}
              options={[
                { value: 'any', label: 'Any time' },
                { value: 'today', label: 'Today' },
              ]}
            />
          </div>
        )}
        <div className={`rd-list-caption ${!search && view === 'My files' ? 'rd-count-only' : ''}`}>
          <span>
            {listingLoading || listingFailed
              ? `Your ${view === 'Trash' ? 'trash' : 'file list'}`
              : view === 'Trash'
                ? 'Restore files for 30 days after deletion. Daily cleanup then removes them permanently.'
                : search
                  ? `Results for “${search}”`
                  : `${rows.length} ${rows.length === 1 ? 'item' : 'items'}`}
          </span>
          {view !== 'My files' && view !== 'Trash' && (
            <Button onClick={() => setView('My files')}>Search all files</Button>
          )}
        </div>
        {state === 'search-pending' && hasFilters && (
          <p role="status">Searching… Matches from the loaded sample list remain available.</p>
        )}
        {trashPending && !dialog && <p role="status">Restoring the file…</p>}
        {trashError === 'trash-restore-error' && (
          <div role="alert">
            <p>Could not restore {targetName}. It is still in Trash. Try again.</p>
            <Button onClick={() => changeTrash('restore')}>Retry restore</Button>
          </div>
        )}
        {localMode && (currentFolder?.id === 'fixture-Work' || view === 'Trash') ? (
          <div className="rd-empty" role="status">
            <h2>Needs a connection</h2>
            <p>
              {view === 'Trash'
                ? 'Trash is unavailable offline. Reconnect to load deleted files.'
                : 'This folder was not opened online on this device, so its contents are not here. Connect to open it.'}
            </p>
          </div>
        ) : listingLoading ? (
          <LoadingReview label={`Loading ${listLabel}…`} />
        ) : listingFailed || searchFailed ? (
          <div className="rd-empty">
            <h2>{searchFailed ? 'Could not search.' : `Could not load ${listLabel}.`}</h2>
            <p role="alert">Check your connection and try again.</p>
            <Button onClick={() => setRetried(true)}>
              {searchFailed ? 'Retry search' : 'Try again'}
            </Button>
          </div>
        ) : empty ? (
          <div className="rd-empty">
            {view === 'Trash' && !hasFilters ? (
              <span className="rd-empty-trash">
                <Glyph name="trash" />
              </span>
            ) : (
              <EntityIcon kind="doc" size={48} />
            )}
            <h2>
              {hasFilters
                ? 'No matching files'
                : view === 'Trash'
                  ? 'Trash is empty'
                  : view === 'Shared with me'
                    ? 'No shared files yet'
                    : 'Room for your next idea'}
            </h2>
            <p>
              {hasFilters
                ? 'Try another name or clear your filters.'
                : view === 'Trash'
                  ? 'Files you delete will appear here so you can restore them.'
                  : view === 'Shared with me'
                    ? 'Files shared with your account will appear here.'
                    : 'Choose New to start a Doc, Sheet or Space.'}
            </p>
            {hasFilters && !hasStructuredFilters && (
              <Button onClick={clearFilters}>Clear filters</Button>
            )}
          </div>
        ) : (
          <div
            className={`rd-file-list ${layout === 'grid' ? 'rd-file-grid' : ''}`}
            role="list"
            aria-label="Files"
          >
            <div className="rd-column-head" aria-hidden="true">
              <span>Name</span>
              <span>{view === 'Trash' ? 'Recovery' : 'Last edited'}</span>
              <span />
            </div>
            {rows.map((file) => (
              <div className="rd-file" role="listitem" key={file.id}>
                <button
                  className="rd-file-open"
                  disabled={
                    view === 'Trash' ||
                    (localMode && file.kind !== 'folder' && !downloaded(file.id))
                  }
                  title={
                    view === 'Trash'
                      ? 'Restore this file before opening it.'
                      : localMode && file.kind !== 'folder' && !downloaded(file.id)
                        ? 'Needs a connection. This file is not downloaded in the sample.'
                        : undefined
                  }
                  onClick={() => openFile(file)}
                >
                  <span
                    className="rd-file-icon"
                    style={{
                      color:
                        file.kind === 'folder' && folderColors[file.id]
                          ? `var(--fill-${folderColors[file.id]}-bg)`
                          : undefined,
                    }}
                  >
                    {file.kind === 'folder' ? (
                      <Glyph name="folder" />
                    ) : (
                      <FileIdentity kind={file.kind} emoji={filenameEmoji(file.name)} size={32} />
                    )}
                  </span>
                  <span>
                    <strong>{file.name}</strong>
                    <small>
                      {file.kind !== 'folder' && (
                        <>
                          <span className="rd-file-type">
                            <EntityIcon kind={file.kind} size={16} />
                            {file.kind === 'doc'
                              ? 'Doc'
                              : file.kind === 'sheet'
                                ? 'Sheet'
                                : 'Space'}
                          </span>
                          {' · '}
                        </>
                      )}
                      {file.detail}
                      {file.access !== 'owner' && (
                        <span>
                          {' '}
                          ·{' '}
                          {state === 'shared-unknown-owner'
                            ? 'Owner unavailable'
                            : `Owner: ${file.ownerName ?? 'Owner unavailable'}`}
                        </span>
                      )}
                      {localMode && file.kind !== 'folder' && (
                        <span>
                          {' '}
                          ·{' '}
                          {downloaded(file.id)
                            ? '⤓ Available offline · Read only'
                            : '⌁ Needs a connection'}
                        </span>
                      )}
                      {view === 'Trash' && (
                        <span>
                          {' '}
                          · Deleted {recoveryExpired(file.id) ? 'September' : 'October'} 18, 2026
                        </span>
                      )}
                      <TagLabelsReview tags={tagsFor(file)} />
                    </small>
                  </span>
                </button>
                <span className={`rd-file-date${view === 'Trash' ? ' rd-file-recovery' : ''}`}>
                  {view === 'Trash'
                    ? recoveryExpired(file.id)
                      ? 'Recovery expired'
                      : 'Restore until Nov 17'
                    : file.date}
                </span>
                {!localMode && (
                  <ActionMenu
                    label={`More actions for ${file.name}`}
                    actions={
                      view === 'Trash'
                        ? [
                            {
                              label: 'Restore',
                              disabled: trashPending || recoveryExpired(file.id),
                              onClick: () => changeTrash('restore', file.id),
                            },
                            {
                              label: 'Delete permanently…',
                              disabled: trashPending,
                              destructive: true,
                              onClick: () => {
                                setTarget(file.id);
                                setTrashError('');
                                setDialog('Delete permanently');
                              },
                            },
                          ]
                        : [
                            {
                              label: 'Open',
                              onClick: () => openFile(file),
                            },
                            ...(file.kind !== 'folder'
                              ? [
                                  {
                                    label: 'Tags…',
                                    onClick: () => {
                                      setTarget(file.id);
                                      setDialog('Tags');
                                    },
                                  },
                                ]
                              : []),
                            ...(file.access !== 'owner'
                              ? [
                                  {
                                    label: 'File into folder…',
                                    onClick: () => {
                                      setTarget(file.id);
                                      setDestination(file.parentId ?? '');
                                      setDialog('File into folder');
                                    },
                                  },
                                ]
                              : ['Share…', 'Rename…', 'Move…'].map((label) => ({
                                  label,
                                  onClick: () => {
                                    setTarget(file.id);
                                    setName(file.name);
                                    if (label === 'Move…') setDestination(file.parentId ?? '');
                                    setDialog(label);
                                  },
                                }))),
                            {
                              label: 'Available offline on this device',
                              onClick: () =>
                                setNotice(
                                  'Downloaded. This browser may clear offline files when space runs low.',
                                ),
                            },
                            ...(file.access === 'owner'
                              ? [
                                  {
                                    label: 'Trash',
                                    destructive: true,
                                    onClick: () => trashFile(file),
                                  },
                                ]
                              : []),
                          ]
                    }
                  />
                )}
              </div>
            ))}
          </div>
        )}
        <div
          className={layout === 'grid' ? 'rd-file-grid rd-trash-grid' : ''}
          role="list"
          aria-label="Trash folder"
        >
          {' '}
          {view === 'My files' &&
            !listingLoading &&
            !listingFailed &&
            !search &&
            (kind === 'all' || kind === 'folder') &&
            !tag && (
              <div className="rd-file" role="listitem">
                <button className="rd-file-open" onClick={() => setView('Trash')}>
                  <span className="rd-file-icon">
                    <Glyph name="trash" />
                  </span>
                  <span>
                    <strong>Trash</strong>
                    <small>Permanent folder · {trashed.length} deleted files</small>
                  </span>
                </button>
                <span className="rd-file-date" />
              </div>
            )}
        </div>
        <p className="rd-feedback" role="status">
          {notice}
        </p>
      </div>
      {dialog === 'Import file…' && (
        <ImportDialog
          open
          destination={currentFolder?.name ?? 'My files'}
          onOpenChange={(open) => {
            if (!open) setDialog('');
          }}
        />
      )}
      <Modal
        icon="palette"
        title={`Folder color · ${currentFolder?.name ?? 'Folder'}`}
        description="Choose a color for this folder. This preview keeps the choice until you reload."
        open={folderColorOpen && Boolean(currentFolder)}
        onOpenChange={setFolderColorOpen}
      >
        <div className="rd-profile-colors rd-folder-colors" aria-label="Folder colors">
          {fillPresets
            .filter((preset) => preset.id.endsWith('-strong'))
            .map((preset) => (
              <Button
                key={preset.id}
                aria-label={preset.label}
                title={preset.label}
                aria-pressed={Boolean(
                  currentFolder && folderColors[currentFolder.id] === preset.id,
                )}
                style={{
                  background: `var(--fill-${preset.id}-bg)`,
                  color: `var(--fill-${preset.id}-fg)`,
                }}
                onClick={() => {
                  if (!currentFolder) return;
                  setFolderColors((colors) => ({ ...colors, [currentFolder.id]: preset.id }));
                  setFolderColorOpen(false);
                  setNotice(`Color changed for ${currentFolder.name} in this preview.`);
                }}
              >
                <Glyph name="folder" />
              </Button>
            ))}
        </div>
        <div className="sp-actions">
          <Button onClick={() => setFolderColorOpen(false)}>Cancel</Button>
          <Button
            disabled={!currentFolder || !folderColors[currentFolder.id]}
            onClick={() => {
              if (!currentFolder) return;
              setFolderColors((colors) => {
                const next = { ...colors };
                delete next[currentFolder.id];
                return next;
              });
              setFolderColorOpen(false);
              setNotice(`Default color restored for ${currentFolder.name} in this preview.`);
            }}
          >
            Reset to default
          </Button>
        </div>
      </Modal>
      <Modal
        icon={
          dialog === 'Empty trash' || dialog === 'Delete permanently'
            ? 'trash'
            : dialog === 'Share…'
              ? 'share'
              : dialog === 'Tags'
                ? 'info'
                : 'folder'
        }
        title={
          dialog === 'Empty trash'
            ? 'Empty Trash permanently?'
            : dialog === 'Delete permanently'
              ? `Delete “${targetName}” permanently?`
              : creating
                ? `New ${dialog}`
                : `${dialog.replace('…', '')} · ${targetName}`
        }
        description={
          dialog === 'Empty trash'
            ? `Permanently delete all ${trashed.length} files listed below. You cannot undo this or restore them later.`
            : dialog === 'Delete permanently'
              ? `This permanently removes “${targetName}”${targetFile?.kind === 'folder' ? ' and its deleted contents' : ''}. You cannot undo this or restore it from Trash.`
              : creating
                ? `Choose a name for your new ${dialog.toLowerCase()}.`
                : dialog === 'Tags'
                  ? undefined
                  : dialog === 'Share…'
                    ? 'Manage who can open this file.'
                    : dialog === 'Rename…'
                      ? 'Choose a new name for this file.'
                      : 'Choose the destination folder.'
        }
        open={Boolean(dialog) && dialog !== 'Import file…'}
        dismissDisabled={dialogBusy}
        onOpenChange={(open) => {
          if (!open && !dialogBusy) {
            setFileMutationFailed(false);
            setDialog('');
          }
        }}
      >
        {dialog === 'Share…' ? (
          <SharingContent kind={items.find((item) => item.id === target)?.kind ?? 'folder'} />
        ) : dialog === 'Tags' ? (
          <TagsReview
            key={target}
            initialTags={targetFile ? tagsFor(targetFile) : []}
            suggestions={items.flatMap(tagsFor)}
            onChange={(tags) => {
              setPersonalTags((current) => ({ ...current, [target]: tags }));
              setItems((current) =>
                current.map((file) =>
                  file.id === target ? { ...file, tags: tags.join(', ') } : file,
                ),
              );
            }}
            onClose={() => setDialog('')}
          />
        ) : dialog === 'File into folder' || dialog === 'Move…' ? (
          <>
            <Choice
              label="Destination folder"
              disabled={dialogBusy}
              value={destination}
              onChange={setDestination}
              options={[
                { value: '', label: 'My files' },
                ...items
                  .filter(
                    (item) =>
                      item.kind === 'folder' &&
                      !isWithinTarget(item.id) &&
                      !trashed.includes(item.id),
                  )
                  .map((folder) => ({ value: folder.id, label: folder.name })),
              ]}
            />
            <p>
              {dialog === 'File into folder'
                ? 'This files a reference in your own folder. The original file and its access stay unchanged.'
                : 'Move this file to another folder.'}
            </p>
          </>
        ) : dialog === 'Empty trash' ? (
          <ul aria-label="Files to delete permanently">
            {items
              .filter((file) => trashed.includes(file.id))
              .map((file) => (
                <li key={file.id}>{file.name}</li>
              ))}
          </ul>
        ) : dialog === 'Delete permanently' ? null : (
          <label>
            Name
            <input
              disabled={dialogBusy}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Untitled"
            />
          </label>
        )}
        {fileMutationFailed && dialog && (
          <p role="alert">
            {creating
              ? 'Could not create the file. Your name is kept; no file was created.'
              : dialog === 'Rename…'
                ? `Could not rename ${targetName}. Its original name is unchanged; your new name is kept.`
                : `Could not ${dialog === 'File into folder' ? 'file' : 'move'} ${targetName}. Its location is unchanged; your destination is kept.`}{' '}
            Try again. This is a local preview.
          </p>
        )}
        {fileMutationPending && dialog && (
          <p role="status">
            {creating
              ? 'Creating file…'
              : dialog === 'Rename…'
                ? 'Renaming file…'
                : dialog === 'File into folder'
                  ? 'Filing reference…'
                  : 'Moving file…'}{' '}
            Pending state preview; no server request is running.
          </p>
        )}
        {trashError && dialog && (
          <p role="alert">
            {dialog === 'Empty trash'
              ? 'Could not empty Trash. All listed files are still in Trash.'
              : `Could not delete ${targetName}. It is still in Trash.`}{' '}
            Try again.
          </p>
        )}
        {trashPending && dialog && (
          <p role="status">
            {dialog === 'Empty trash' ? 'Emptying Trash…' : `Deleting ${targetName}…`}
          </p>
        )}
        {dialog !== 'Tags' && (
          <div className="sp-actions">
            {dialog !== 'Share…' && (
              <Button
                disabled={dialogBusy}
                onClick={() => {
                  setFileMutationFailed(false);
                  setDialog('');
                }}
              >
                Cancel
              </Button>
            )}
            <Button
              primary
              disabled={dialogBusy}
              onClick={() => {
                if (dialog === 'Empty trash') {
                  changeTrash('empty');
                  return;
                }
                if (dialog === 'Delete permanently') {
                  changeTrash('delete');
                  return;
                }
                if (['Doc', 'Sheet', 'Space', 'Folder'].includes(dialog)) {
                  const next = {
                    id: `created-${nextFileId.current++}`,
                    name: name || 'Untitled',
                    kind: dialog.toLowerCase() as 'doc' | 'sheet' | 'space' | 'folder',
                    access: 'owner' as const,
                  };
                  setItems([
                    ...items,
                    {
                      ...next,
                      detail: next.kind === 'folder' ? 'Folder' : 'Private',
                      date: 'Just now',
                      tags: '',
                      parentId: currentFolder?.id ?? null,
                    },
                  ]);
                  if (next.kind !== 'folder')
                    onOpen?.({
                      ...next,
                      kind: next.kind,
                      locationLabel: currentFolder?.name ?? 'My files',
                    });
                }
                if (dialog === 'Rename…')
                  setItems(
                    items.map((file) =>
                      file.id === target ? { ...file, name: name || file.name } : file,
                    ),
                  );
                if (dialog === 'File into folder' || dialog === 'Move…')
                  setItems(
                    items.map((file) =>
                      file.id === target ? { ...file, parentId: destination || null } : file,
                    ),
                  );
                if (dialog !== 'Share…')
                  setNotice(
                    dialog === 'Delete permanently'
                      ? `${targetName} was deleted permanently.`
                      : `${actionLabel}: ${name || targetName} in this preview.`,
                  );
                setFileMutationFailed(false);
                setDialog('');
              }}
            >
              {dialogBusy
                ? 'Please wait…'
                : trashError || fileMutationFailed
                  ? 'Try again'
                  : actionLabel}
            </Button>
          </div>
        )}
      </Modal>
    </Shell>
  );
}
export function DocumentSurface({
  sheet = false,
  unavailable = false,
  table = false,
  readOnly = false,
}: {
  readOnly?: boolean;
  sheet?: boolean;
  unavailable?: boolean;
  table?: boolean;
}) {
  if (sheet)
    return (
      <div className="rd-sheet-scroll">
        <table className="rd-sheet">
          <thead>
            <tr>
              {['', 'A', 'B', 'C', 'D', 'E', 'F'].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 16 }, (_, i) => (
              <tr key={i}>
                <th>{i + 1}</th>
                {[0, 1, 2, 3, 4, 5].map((j) => (
                  <td
                    key={j}
                    className={i === 0 ? 'rd-sheet-heading' : i === 7 ? 'rd-sheet-total' : ''}
                  >
                    {[
                      ['CATEGORY', 'PLANNED', 'ACTUAL', 'REMAINING'],
                      ['Groceries', '$480.00', '$412.50', '$67.50'],
                      ['Transport', '$120.00', '$84.00', '$36.00'],
                      ['Home', '$200.00', '$145.00', '$55.00'],
                      ['Days out', '$160.00', '$92.00', '$68.00'],
                      ['Books & hobbies', '$90.00', '$58.00', '$32.00'],
                      [],
                      ['Total', '$1,050.00', '$791.50', '$258.50'],
                    ][i]?.[j] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="rd-sheet-tabs">
          <span>October</span>
          <span>November</span>
          {!readOnly && <span>＋</span>}
        </div>
      </div>
    );
  return (
    <div className="rd-paper-wrap">
      <article className="rd-paper">
        <p className="rd-doc-kicker">OCTOBER · A LITTLE FURTHER AFIELD</p>
        <h1>Autumn, unhurried.</h1>
        <p className="rd-doc-intro">
          A weekend away, a few good meals, and enough room to change our minds.
        </p>
        <div className="rd-rule" />
        <h2>The plan</h2>
        <p>
          Leave after breakfast on Friday. Take the coast road, stop somewhere for lunch, and arrive
          before the light goes.
        </p>
        <h2>A few things to make time for</h2>
        <ul>
          <li>A long walk with no particular destination</li>
          <li>The little bookshop near the harbor</li>
          <li>Cooking something we haven’t made before</li>
        </ul>
        <h2>A little room in the budget</h2>
        <p>
          We have <strong>{unavailable ? 'Source unavailable' : '$258.50'}</strong> left for the
          month.{' '}
          {unavailable
            ? 'The linked figure needs separate access.'
            : 'A comfortable amount for a small adventure.'}
        </p>

        {table && (
          <>
            <h2>What we spent</h2>
            <table className="rd-formula-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Actual</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Groceries</td>
                  <td>$412.50</td>
                </tr>
                <tr>
                  <td>Transport</td>
                  <td>$84.00</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
        <h2>Before we leave</h2>
        <p>
          Check the forecast. Water the plants. Download the reservations so they’re with us even
          without a connection.
        </p>
      </article>
    </div>
  );
}
function NameVersionDialog({
  open,
  onOpenChange,
  onSave,
  disabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (name: string) => void;
  disabled?: boolean;
}) {
  const [name, setName] = useState('');
  return (
    <Modal
      icon="history"
      title="Name this version"
      description="Name the current saved document so you can find this moment again."
      open={open}
      onOpenChange={onOpenChange}
    >
      <label>
        Version name
        <input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="sp-actions">
        <Button onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button
          primary
          disabled={disabled || !name.trim()}
          onClick={() => {
            onSave(name.trim());
            onOpenChange(false);
          }}
        >
          Save version name
        </Button>
      </div>
    </Modal>
  );
}
type DeletedSpaceEntry = {
  id: string;
  entry: SpaceEntry;
  originalParent: string | null;
  originalLocation: string;
  deleted: string;
};
const deletedSpaceEntries: DeletedSpaceEntry[] = [
  {
    id: 'old-itinerary',
    entry: { name: 'Old itinerary', kind: 'doc' },
    originalParent: 'Weekend trip',
    originalLocation: 'Autumn plans / Weekend trip',
    deleted: 'October 20, 2026',
  },
  {
    id: 'old-expenses',
    entry: { name: 'Old expenses', kind: 'sheet' },
    originalParent: null,
    originalLocation: 'Autumn plans',
    deleted: 'October 19, 2026',
  },
  {
    id: 'archived-plans',
    entry: {
      name: 'Archived plans',
      kind: 'folder',
      children: [
        { name: 'Earlier notes', kind: 'doc' },
        { name: 'Earlier costs', kind: 'sheet' },
      ],
    },
    originalParent: null,
    originalLocation: 'Autumn plans',
    deleted: 'October 18, 2026',
  },
  {
    id: 'lost-checklist',
    entry: { name: 'Packing checklist', kind: 'doc' },
    originalParent: 'missing-parent',
    originalLocation: 'Original location unavailable',
    deleted: 'October 17, 2026',
  },
];
function findSpaceEntry(entries: SpaceEntry[], name: string): SpaceEntry | undefined {
  for (const entry of entries) {
    if (entry.name === name) return entry;
    const child = findSpaceEntry(entry.children ?? [], name);
    if (child) return child;
  }
}
function restoreSpaceEntry(entries: SpaceEntry[], item: DeletedSpaceEntry): SpaceEntry[] {
  if (!item.originalParent || !findSpaceEntry(entries, item.originalParent))
    return [...entries, item.entry];
  return restoreSpaceChild(entries, item);
}
function restoreSpaceChild(entries: SpaceEntry[], item: DeletedSpaceEntry): SpaceEntry[] {
  return entries.map((entry) =>
    entry.name === item.originalParent
      ? { ...entry, children: [...(entry.children ?? []), item.entry] }
      : {
          ...entry,
          ...(entry.children ? { children: restoreSpaceChild(entry.children, item) } : {}),
        },
  );
}
function SpaceTrashCollection({
  items,
  entries,
  canRestore,
  canDelete,
  offline,
  onRestore,
  onDelete,
}: {
  items: DeletedSpaceEntry[];
  entries: SpaceEntry[];
  canRestore: boolean;
  canDelete: boolean;
  offline: boolean;
  onRestore: (item: DeletedSpaceEntry) => void;
  onDelete: (item: DeletedSpaceEntry) => void;
}) {
  const [deleting, setDeleting] = useState<DeletedSpaceEntry>();
  return (
    <section className="rd-content rd-space-trash" aria-label="Deleted Space contents">
      <p className="sp-muted">
        Restore pages, sheets and folders to their original location. Folder contents stay together.
      </p>
      <p className="rd-preview-note">
        Local preview · These actions update this example only; reloading resets it.
      </p>
      {offline && <p role="status">Reconnect to restore or permanently delete Space contents.</p>}
      {items.length ? (
        <div role="list" aria-label="Deleted pages and folders">
          {items.map((item) => {
            const missingParent = Boolean(
              item.originalParent && !findSpaceEntry(entries, item.originalParent),
            );
            return (
              <div
                key={item.id}
                className="rd-space-trash-row"
                role="listitem"
                aria-label={item.entry.name}
              >
                <span className="rd-file-icon">
                  {item.entry.kind === 'folder' ? (
                    <Glyph name="folder" />
                  ) : (
                    <EntityIcon kind={item.entry.kind} size={32} />
                  )}
                </span>
                <div className="rd-space-trash-detail">
                  <strong>{item.entry.name}</strong>
                  <span>
                    {item.entry.kind === 'doc'
                      ? 'Doc'
                      : item.entry.kind === 'sheet'
                        ? 'Sheet'
                        : `Folder · ${item.entry.children?.length ?? 0} items`}
                  </span>
                  <span>From {item.originalLocation}</span>
                  <span>Deleted {item.deleted}</span>
                  {missingParent && (
                    <span>
                      Restores to Autumn plans because its original location is unavailable.
                    </span>
                  )}
                  {item.entry.children && (
                    <span>
                      Includes {item.entry.children.map((child) => child.name).join(' and ')}.
                    </span>
                  )}
                </div>
                {(canRestore || canDelete) && (
                  <div className="rd-space-trash-actions">
                    {canRestore && (
                      <Button
                        disabled={offline}
                        aria-label={`Restore ${item.entry.name}`}
                        onClick={() => onRestore(item)}
                      >
                        Restore
                      </Button>
                    )}
                    {canDelete && (
                      <ActionMenu
                        label={`Actions for deleted ${item.entry.name}`}
                        actions={[
                          {
                            label: 'Delete permanently',
                            icon: <Glyph name="trash" />,
                            destructive: true,
                            disabled: offline,
                            onClick: () => setDeleting(item),
                          },
                        ]}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rd-empty">
          <Glyph name="trash" />
          <h2>Space trash is empty</h2>
          <p>Deleted pages, sheets and folders appear here.</p>
        </div>
      )}
      <Modal
        icon="trash"
        title={`Delete ${deleting?.entry.name ?? 'item'} permanently?`}
        description={
          deleting?.entry.children
            ? 'This deletes the folder and all of its contents from this local preview. They cannot be restored here afterward.'
            : 'This deletes the item from this local preview. It cannot be restored here afterward.'
        }
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(undefined);
        }}
      >
        {deleting?.entry.children && (
          <ul>
            {deleting.entry.children.map((child) => (
              <li key={child.name}>{child.name}</li>
            ))}
          </ul>
        )}
        <div className="sp-actions">
          <Button onClick={() => setDeleting(undefined)}>Cancel</Button>
          <Button
            primary
            onClick={() => {
              if (deleting) onDelete(deleting);
              setDeleting(undefined);
            }}
          >
            Delete permanently
          </Button>
        </div>
      </Modal>
    </section>
  );
}
export function EditorMockup({
  sheet = false,
  guest = false,
  viewOnly = false,
  offline = false,
  space = false,
  formula = false,
  table = false,
  collaborator = false,
  collapsed = false,
  title,
  locationLabel = 'Household',
  initialPage = 'Overview',
  onBack,
  onProfile,
  onHistory,
  saveState = 'saved',
  onRetrySave,
  onNameVersion,
  exportState = 'ready',
  editorContent,
  presence,
  beforeTitle,
  appearanceAction,
  navigationAppearance,
}: {
  navigationAppearance?: CSSProperties;
  /** Storybook appearance exploration; no production persistence. */
  beforeTitle?: (page: string) => ReactNode;
  appearanceAction?: ReactNode;
  presence?: Collaborator[];
  exportState?: 'ready' | 'open' | 'loading' | 'error' | 'print-error';
  editorContent?: ReactNode | ((page: string, kind: 'doc' | 'sheet') => ReactNode);
  onNameVersion?: (name: string) => void;
  onBack?: () => void;
  onProfile?: () => void;
  onHistory?: () => void;
  saveState?: 'saved' | 'saving' | 'failed';
  onRetrySave?: () => void;
  sheet?: boolean;
  guest?: boolean;
  viewOnly?: boolean;
  offline?: boolean;
  space?: boolean;
  formula?: boolean;
  table?: boolean;
  collaborator?: boolean;
  collapsed?: boolean;
  title?: string;
  locationLabel?: string;
  initialPage?: string;
}) {
  const [iconHint, setIconHint] = useState(false);
  const [share, setShare] = useState(false);
  const [selected, setSelected] = useState(initialPage);
  const [spaceEntries, setSpaceEntries] = useState(spacePages);
  const [spaceTrash, setSpaceTrash] = useState(deletedSpaceEntries);
  const [spaceTrashNotice, setSpaceTrashNotice] = useState('');
  const [checkpointNames, setCheckpointNames] = useState<Record<string, string | null>>({});
  const [checkpoint, setCheckpoint] = useState('10:15 · Ready for the trip');
  const [versionName, setVersionName] = useState('');
  const [naming, setNaming] = useState(false);
  const [panel, setPanel] = useState(exportState !== 'ready' ? 'Export' : formula ? 'Formula' : '');
  const [exportStatus, setExportStatus] = useState(exportState);
  const panelTitleRef = useRef<HTMLHeadingElement>(null);
  const documentMenuRef = useRef<HTMLButtonElement>(null);
  const focusOpenedPanel = useRef(false);
  const closePanel = () => {
    setPanel('');
    documentMenuRef.current?.focus();
  };
  const [notice, setNotice] = useState('');
  const isSpaceTrash = space && selected === 'Trash';
  const { profile: currentProfile } = useContext(ReviewProfileContext);
  const presentPeople = presence ?? [
    {
      id: 'self',
      name: guest ? 'Guest' : currentProfile.name,
      icon: guest ? 'lucide:user-round' : currentProfile.icon,
      color: guest ? 'var(--fill-info-strong-bg)' : `var(--fill-${currentProfile.color}-bg)`,
      foreground: guest ? 'var(--fill-info-strong-fg)' : `var(--fill-${currentProfile.color}-fg)`,
    },
    {
      id: 'peer',
      name: guest ? 'Collaborator' : 'Alex Kim',
      icon: 'lucide:user-round',
      color: 'var(--fill-success-strong-bg)',
      foreground: 'var(--fill-success-strong-fg)',
      jump: offline
        ? undefined
        : () => setNotice(`Simulated jump to ${guest ? 'Collaborator' : 'Alex Kim'}’s position.`),
    },
  ];
  const name = space ? selected : (title ?? (sheet ? 'Quarterly budget' : 'Autumn plans'));
  return (
    <Shell
      navigationAppearance={navigationAppearance}
      sidebar={space}
      collapsed={collapsed}
      offline={offline}
      compact={!space}
      space={space}
      spaceEntries={spaceEntries}
      guest={guest}
      canEdit={!viewOnly}
      selected={selected}
      onSelect={(next) => {
        if (next === 'My files' && onBack) onBack();
        else if (next === 'Your profile' && onProfile) onProfile();
        else {
          setSelected(next);
          if (next === 'Trash') {
            setPanel('');
            setNotice('');
            setShare(false);
            setNaming(false);
          }
        }
      }}
    >
      {!isSpaceTrash && beforeTitle?.(name)}
      <header className="rd-editor-header">
        <div className="rd-editor-title">
          {guest ? (
            <div className="rd-guest-gem">
              <span className="rd-gem-wiggle">
                <GemLogo />
              </span>
            </div>
          ) : !space ? (
            <Button
              className="sp-quiet"
              aria-label="Back to files"
              onClick={() =>
                onBack
                  ? onBack()
                  : setNotice('Return to your previous folder, search and scroll position.')
              }
            >
              <Glyph name="back" />
            </Button>
          ) : null}
          {isSpaceTrash ? (
            <span className="rd-file-icon" aria-hidden="true">
              <Glyph name="trash" />
            </span>
          ) : (
            <Tooltip.Root open={iconHint} onOpenChange={setIconHint}>
              <Tooltip.Trigger
                className="rd-file-identity-trigger"
                closeOnClick={false}
                onPointerDown={(event) => {
                  if (event.pointerType === 'touch') setIconHint(true);
                }}
                aria-label="File icon — customization planned"
                aria-disabled="true"
              >
                <FileIdentity
                  kind={space ? 'space' : sheet ? 'sheet' : 'doc'}
                  emoji={filenameEmoji(space ? 'Autumn plans' : name)}
                  size={24}
                />
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Positioner sideOffset={8} className="rd-tooltip-positioner">
                  <Tooltip.Popup className="sp-ui rd-network-tooltip">
                    Custom file icons are planned. This default icon comes from the file name.
                  </Tooltip.Popup>
                </Tooltip.Positioner>
              </Tooltip.Portal>
            </Tooltip.Root>
          )}
          <div>
            <span className="rd-breadcrumb">
              {space
                ? 'Space · Autumn plans /'
                : guest
                  ? `${sheet ? 'Sheet' : 'Doc'} · Shared document`
                  : `${sheet ? 'Sheet' : 'Doc'} · ${locationLabel} /`}
            </span>
            <h1>{isSpaceTrash ? 'Space trash' : name}</h1>
            {guest && <span className="rd-badge">{viewOnly ? 'View only' : 'Guest editor'}</span>}
          </div>
        </div>
        {!isSpaceTrash && (
          <div
            className="rd-status-slot"
            role="status"
            aria-label="Document save status"
            aria-live="polite"
            aria-atomic="true"
          >
            <DetailsPopover
              label={
                saveState === 'failed' && !viewOnly
                  ? 'Could not save'
                  : offline
                    ? viewOnly
                      ? 'Offline'
                      : 'Offline · keep open'
                    : viewOnly
                      ? 'Connected'
                      : saveState === 'saving'
                        ? 'Saving…'
                        : '✓ Saved'
              }
            >
              <p>
                {offline
                  ? viewOnly
                    ? 'Connection lost. Showing the last loaded content while we reconnect.'
                    : 'Connection lost. Keep this page open; your latest changes have not been confirmed saved.'
                  : viewOnly
                    ? 'You can view this document. You’re connected.'
                    : saveState === 'failed'
                      ? 'Your latest changes have not been saved. Keep this page open and try again.'
                      : saveState === 'saving'
                        ? 'Saving your latest changes. Keep this page open.'
                        : 'All changes are saved. You’re connected.'}
              </p>
              {saveState === 'failed' && (
                <Button disabled={offline} onClick={onRetrySave}>
                  Retry saving
                </Button>
              )}
              {offline && <Button onClick={() => setNotice('Reconnecting…')}>Reconnect</Button>}
            </DetailsPopover>
          </div>
        )}
        {!isSpaceTrash && (
          <div className="rd-editor-actions">
            {appearanceAction}
            <PresenceReview people={presentPeople} selfId={presence ? undefined : 'self'} />
            {guest ? null : viewOnly || collaborator ? (
              <span className="rd-badge">
                {viewOnly ? 'View only' : guest ? 'Guest editor' : 'Can edit'}
              </span>
            ) : null}
            {guest ? (
              <>
                <ThemeMenu />
                <Button
                  aria-label="Export as PDF"
                  disabled={offline || saveState !== 'saved'}
                  title={
                    offline
                      ? 'Reconnect before exporting.'
                      : saveState !== 'saved'
                        ? 'Wait until changes are saved before exporting.'
                        : undefined
                  }
                  onClick={() => setNotice('Preparing PDF…')}
                >
                  <Glyph name="download" /> PDF
                </Button>
              </>
            ) : (
              <ActionMenu
                label="Document actions"
                triggerRef={documentMenuRef}
                finalFocus={() => {
                  const target = focusOpenedPanel.current ? panelTitleRef.current : null;
                  focusOpenedPanel.current = false;
                  return target ?? true;
                }}
                actions={[
                  ...(!viewOnly && !collaborator
                    ? [
                        {
                          label: 'Share',
                          icon: <Glyph name="shared" />,
                          onClick: () => setShare(true),
                        },
                      ]
                    : []),
                  ...['Versions', 'Export', ...(!viewOnly && !sheet ? ['Insert formula'] : [])].map(
                    (label) => ({
                      label,
                      icon: (
                        <Glyph
                          name={
                            label === 'Versions'
                              ? 'history'
                              : label === 'Export'
                                ? 'download'
                                : 'formula'
                          }
                        />
                      ),
                      onClick: () => {
                        if (label === 'Versions' && onHistory) onHistory();
                        else {
                          focusOpenedPanel.current = true;
                          setPanel(label);
                        }
                      },
                    }),
                  ),
                ]}
              />
            )}
          </div>
        )}
      </header>
      {!isSpaceTrash && !viewOnly && editorContent === undefined && (
        <div className="rd-toolbar" aria-label="Editor toolbar representation">
          <span>File</span>
          <span>Edit</span>
          <span>Insert</span>
          <i />
          <span>↶</span>
          <span>↷</span>
          <i />
          <span>100% ⌄</span>
          <span>Normal text ⌄</span>
          <i />
          <b>B</b>
          <em>I</em>
          <u>U</u>
          <span>≡</span>
        </div>
      )}
      <span className="rd-live-alert" role="alert">
        {!isSpaceTrash &&
          !viewOnly &&
          (saveState === 'failed'
            ? 'Your latest changes have not been saved. Keep this page open.'
            : offline
              ? 'Connection lost. Keep this page open to protect unsent changes.'
              : '')}
      </span>
      <div className="rd-editor-body">
        {selected === 'Trash' && space ? (
          guest ? (
            <div className="rd-content">
              <p>Space recovery is available to account editors.</p>
            </div>
          ) : (
            <div className="rd-space-trash-region">
              {spaceTrashNotice && (
                <p className="rd-space-trash-status" role="status">
                  {spaceTrashNotice}
                </p>
              )}
              <SpaceTrashCollection
                items={spaceTrash}
                entries={spaceEntries}
                canRestore={!viewOnly}
                canDelete={!viewOnly && !collaborator}
                offline={offline}
                onRestore={(item) => {
                  const destination =
                    item.originalParent && findSpaceEntry(spaceEntries, item.originalParent)
                      ? item.originalParent
                      : 'Autumn plans';
                  setSpaceEntries((entries) => restoreSpaceEntry(entries, item));
                  setSpaceTrash((items) => items.filter((entry) => entry.id !== item.id));
                  setSpaceTrashNotice(
                    `${item.entry.name} restored to ${destination} in this preview${item.entry.children ? ', with its contents' : ''}.`,
                  );
                }}
                onDelete={(item) => {
                  setSpaceTrash((items) => items.filter((entry) => entry.id !== item.id));
                  setSpaceTrashNotice(
                    `${item.entry.name}${item.entry.children ? ' and its contents' : ''} permanently deleted from this preview.`,
                  );
                }}
              />
            </div>
          )
        ) : editorContent !== undefined ? (
          <div className="rd-live-editor">
            {typeof editorContent === 'function'
              ? editorContent(
                  name,
                  sheet || findSpaceEntry(spaceEntries, selected)?.kind === 'sheet'
                    ? 'sheet'
                    : 'doc',
                )
              : editorContent}
          </div>
        ) : (
          <DocumentSurface
            sheet={sheet || findSpaceEntry(spaceEntries, selected)?.kind === 'sheet'}
            unavailable={guest || offline}
            readOnly={viewOnly}
            table={table}
          />
        )}
        {!isSpaceTrash && panel && (
          <aside className="rd-inspector">
            <div className={panel === 'Versions' ? 'rd-history-heading' : 'rd-modal-title'}>
              {panel === 'Versions' && (
                <Button aria-label="Return to document" onClick={closePanel}>
                  <Glyph name="back" />
                </Button>
              )}
              <h2 ref={panelTitleRef} tabIndex={-1}>
                {panel}
              </h2>
              {panel !== 'Versions' && (
                <Button aria-label="Close panel" onClick={closePanel}>
                  ×
                </Button>
              )}
            </div>
            {panel.includes('formula') || panel === 'Formula' ? (
              <FormulaForm
                onCancel={closePanel}
                onApply={() => {
                  closePanel();
                  setNotice(
                    'Formula inserted in this design preview only. Native document unchanged.',
                  );
                }}
              />
            ) : panel === 'Versions' ? (
              <>
                {!viewOnly && (
                  <Button
                    disabled={saveState !== 'saved' || offline}
                    title={
                      offline
                        ? 'Reconnect before naming a version.'
                        : saveState !== 'saved'
                          ? 'Wait until changes are saved before naming a version.'
                          : undefined
                    }
                    onClick={() => setNaming(true)}
                  >
                    Name current version…
                  </Button>
                )}
                <HistoryContent
                  selected={checkpoint}
                  setSelected={setCheckpoint}
                  namedVersion={versionName}
                  names={checkpointNames}
                  onName={(id, name) =>
                    setCheckpointNames((current) => ({ ...current, [id]: name }))
                  }
                  readOnly={viewOnly}
                  offline={offline}
                />
              </>
            ) : (
              <>
                <p className="sp-muted">
                  {saveState !== 'saved'
                    ? 'Wait until your latest changes are saved before exporting.'
                    : panel === 'Export'
                      ? 'Choose a format for this document.'
                      : 'Document options'}
                </p>
                {exportStatus === 'error' && (
                  <p role="alert">
                    Could not download the export. Your document is unchanged. Choose a format to
                    try again.
                  </p>
                )}
                {exportStatus === 'print-error' && (
                  <p role="alert">
                    Could not open the PDF print dialog. Your document is unchanged. Try PDF again.
                  </p>
                )}
                {exportStatus === 'loading' && (
                  <LoadingReview label="Preparing your download…" size="compact" />
                )}
                {offline && <p role="status">Reconnect before exporting this file.</p>}
                <p className="sp-muted">
                  Univer files keep editable content and images, up to 20 MiB. For PDF, choose Save
                  as PDF in the print dialog.
                </p>
                {['Univer file', 'PDF'].map((label) => (
                  <Button
                    key={label}
                    disabled={saveState !== 'saved' || offline || exportStatus === 'loading'}
                    onClick={() => {
                      setExportStatus('ready');
                      setNotice(`${label} export requested in this preview.`);
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </>
            )}
          </aside>
        )}
      </div>
      {!isSpaceTrash && (notice || viewOnly) && (
        <div className="rd-editor-foot" role="status">
          {notice || 'You can view this document.'}
        </div>
      )}
      <NameVersionDialog
        open={naming}
        onOpenChange={setNaming}
        disabled={saveState !== 'saved' || offline}
        onSave={(version) => {
          setVersionName(version);
          setCheckpoint(`Just now · ${version}`);
          onNameVersion?.(version);
          setNotice(`Version named ${version}.`);
        }}
      />
      <Modal
        icon="share"
        title={`Share ${name}`}
        description="Choose who can open this file."
        open={share}
        onOpenChange={setShare}
      >
        <SharingContent kind={space ? 'space' : sheet ? 'sheet' : 'doc'} />
      </Modal>
    </Shell>
  );
}
export function SharingMockup({
  delegated = false,
  state,
}: {
  delegated?: boolean;
  state?: SharingState;
}) {
  return (
    <div className="sp-ui rd-dialog-stage">
      <section className="rd-dialog-example" aria-label="Sharing design">
        <h1>Share Autumn plans</h1>
        <p className="sp-muted">
          {delegated
            ? 'File admins manage this file. They have no server access.'
            : 'Choose who can open this file.'}
        </p>
        <SharingContent delegated={delegated} state={state} kind="doc" />
      </section>
    </div>
  );
}
function FormulaForm({
  state = 'value',
  onApply,
  onCancel,
}: {
  state?: 'value' | 'private' | 'offline' | 'invalid' | 'loading' | 'empty' | 'table';
  onApply?: () => void;
  onCancel?: () => void;
}) {
  const states: Record<NonNullable<typeof state>, FormulaReviewState> = {
    value: 'scalar',
    private: 'private-source',
    offline: 'offline',
    invalid: 'invalid-formula',
    loading: 'calculating',
    empty: 'empty',
    table: 'table',
  };
  return <FormulaReview state={states[state]} onApply={onApply} onCancel={onCancel} />;
}
export function FormulaMockup({
  state,
}: {
  state?: 'value' | 'private' | 'offline' | 'invalid' | 'loading' | 'empty' | 'table';
}) {
  return (
    <div className="sp-ui rd-dialog-stage">
      <section className="rd-dialog-example">
        <h1>Insert formula</h1>
        <FormulaForm state={state} />
      </section>
    </div>
  );
}
function HistoryContent({
  selected,
  setSelected,
  namedVersion,
  names,
  onName,
  readOnly,
  offline,
}: {
  selected: string;
  setSelected: (value: string) => void;
  namedVersion?: string;
  names: Record<string, string | null>;
  onName: (id: string, name: string | null) => void;
  readOnly: boolean;
  offline: boolean;
}) {
  const today = [
    '09:00 · Unnamed version',
    '10:15 · Ready for the trip',
    '11:45 · Before restore',
    '12:30 · Latest',
    ...(namedVersion ? [`Just now · ${namedVersion}`] : []),
  ];
  const older = selected.startsWith('October');
  const day = selected.match(/^October (\d+)/)?.[1] ?? '19';
  const checkpoints = older
    ? [
        `October ${day} · Final checkpoint`,
        `October ${day} · 11:45 · Before restore`,
        `October ${day} · 10:15 · Ready for the trip`,
      ]
    : [...today].reverse();
  return (
    <div className="rd-form">
      <p className="sp-muted">Previewing leaves your live document unchanged.</p>
      <div className="rd-history-tabs">
        <Button
          onClick={() => {
            setSelected('10:15 · Ready for the trip');
          }}
          aria-pressed={!older}
        >
          Today
        </Button>
        <Button
          onClick={() => {
            setSelected('October 19 · Final checkpoint');
          }}
          aria-pressed={older}
        >
          Older days
        </Button>
      </div>
      {older ? (
        <>
          <h3>October 2026 · UTC</h3>
          <div className="rd-calendar">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((x) => (
              <span key={x} className="rd-weekday">
                {x}
              </span>
            ))}
            {Array.from({ length: 4 }, (_, i) => (
              <span key={`offset-${i}`} aria-hidden="true" />
            ))}
            {Array.from({ length: 31 }, (_, i) => (
              <Button
                key={i}
                aria-pressed={Number(day) === i + 1}
                disabled={![2, 7, 12, 17, 18, 19].includes(i + 1)}
                onClick={() => setSelected(`October ${i + 1} · Final checkpoint`)}
              >
                {i + 1}
              </Button>
            ))}
          </div>
        </>
      ) : (
        <label>
          Today · UTC
          <input
            type="range"
            min="0"
            max={today.length - 1}
            value={Math.max(0, today.indexOf(selected))}
            onChange={(event) => setSelected(today[Number(event.target.value)])}
          />
        </label>
      )}
      <VersionNamesReview
        compact
        showCurrentAction={false}
        readOnly={readOnly}
        offline={offline}
        selectedId={selected}
        onSelect={setSelected}
        onName={onName}
        versions={(!checkpoints.includes(selected) ? [selected, ...checkpoints] : checkpoints).map(
          (id) => {
            const [hour, minute] = (id.match(/\d{2}:\d{2}/)?.[0] ?? '23:59').split(':').map(Number);
            return {
              id,
              capturedAt: Date.UTC(
                2026,
                9,
                id.startsWith('October') ? Number(day) : 20,
                hour,
                minute,
              ),
              name: Object.hasOwn(names, id)
                ? names[id]
                : id.includes('Ready for the trip')
                  ? 'Ready for the trip'
                  : id.startsWith('Just now')
                    ? (namedVersion ?? null)
                    : null,
              beforeRestore: id.includes('Before restore'),
            };
          },
        )}
      />
    </div>
  );
}
function historyLabel(id: string, names: Record<string, string | null>) {
  return Object.hasOwn(names, id)
    ? `${id.slice(0, id.lastIndexOf(' · '))} · ${names[id] ?? 'Unnamed version'}`
    : id;
}
export function HistoryMockup({
  state = 'ready',
  calendar = false,
  confirmation = false,
  viewOnly = false,
  sheet = false,
  title = 'Autumn plans',
  namedVersion,
  onBack,
  onFiles,
  onProfile,
  onNameVersion,
  saveState = 'saved',
  offline = false,
  checkpointNames,
  onCheckpointName,
}: {
  state?: 'ready' | 'loading' | 'empty' | 'error';
  viewOnly?: boolean;
  sheet?: boolean;
  title?: string;
  namedVersion?: string;
  onBack?: () => void;
  onFiles?: () => void;
  onProfile?: () => void;
  onNameVersion?: (name: string) => void;
  checkpointNames?: Record<string, string | null>;
  onCheckpointName?: (id: string, name: string | null) => void;
  saveState?: 'saved' | 'saving' | 'failed';
  offline?: boolean;
  calendar?: boolean;
  confirmation?: boolean;
}) {
  const [historyState, setHistoryState] = useState(state);
  const [restore, setRestore] = useState(confirmation);
  const [selected, setSelected] = useState(
    namedVersion
      ? `Just now · ${namedVersion}`
      : calendar
        ? 'October 19 · Final checkpoint'
        : '10:15 · Ready for the trip',
  );
  const [notice, setNotice] = useState('');
  const [naming, setNaming] = useState(false);
  const [currentName, setCurrentName] = useState(namedVersion);
  const [localVersionNames, setVersionNames] = useState<Record<string, string | null>>({});
  const versionNames = checkpointNames ?? localVersionNames;
  const nameCheckpoint = (id: string, name: string | null) => {
    setVersionNames((current) => ({ ...current, [id]: name }));
    onCheckpointName?.(id, name);
  };
  const selectedLabel = historyLabel(selected, versionNames);
  return (
    <Shell
      compact
      offline={offline}
      onSelect={(next) => (next === 'Your profile' ? onProfile?.() : onFiles?.())}
    >
      <header className="rd-page-header rd-history-header">
        <div className="rd-history-heading">
          <Button
            aria-label="Return to document"
            onClick={() =>
              onBack ? onBack() : setNotice('Return to the live document without restoring.')
            }
          >
            <Glyph name="back" />
          </Button>
          <div>
            <p className="rd-eyebrow">{title}</p>
            <h1>Version history</h1>
          </div>
        </div>
        <div className="sp-actions">
          {!viewOnly && (
            <>
              <Button
                disabled={saveState !== 'saved' || offline || historyState !== 'ready'}
                title={
                  offline
                    ? 'Reconnect before naming a version.'
                    : saveState !== 'saved'
                      ? 'Wait until changes are saved before naming a version.'
                      : undefined
                }
                onClick={() => setNaming(true)}
              >
                Name current version…
              </Button>
              <Button
                primary
                disabled={offline || saveState !== 'saved' || historyState !== 'ready'}
                onClick={() => setRestore(true)}
              >
                Restore this version…
              </Button>
            </>
          )}
        </div>
      </header>
      {!viewOnly && (offline || saveState !== 'saved') && (
        <p className="rd-history-selection" role="status">
          {offline
            ? 'Reconnect before naming or restoring a version.'
            : 'Save your latest changes before naming the current version or restoring. Older version names can still be changed.'}
        </p>
      )}
      {historyState === 'ready' ? (
        <>
          <p className="rd-history-selection" role="status">
            Preview ·{' '}
            {selected.startsWith('October') ? selectedLabel : `October 20, 2026 · ${selectedLabel}`}{' '}
            · UTC
          </p>
          <div className="rd-history">
            <aside className="rd-inspector">
              <div className="rd-history-desktop">
                <HistoryContent
                  selected={selected}
                  setSelected={setSelected}
                  namedVersion={currentName}
                  names={versionNames}
                  onName={nameCheckpoint}
                  readOnly={viewOnly}
                  offline={offline}
                />
              </div>
              <details className="rd-history-disclosure" open={calendar}>
                <summary>Choose version · {selectedLabel}</summary>
                <HistoryContent
                  selected={selected}
                  setSelected={setSelected}
                  namedVersion={currentName}
                  names={versionNames}
                  onName={nameCheckpoint}
                  readOnly={viewOnly}
                  offline={offline}
                />
              </details>
            </aside>
            <DocumentSurface sheet={sheet} readOnly />
          </div>
        </>
      ) : historyState === 'loading' ? (
        <LoadingReview label="Loading versions…" />
      ) : (
        <div className="rd-empty" role={historyState === 'error' ? 'alert' : 'status'}>
          <h2>{historyState === 'empty' ? 'No versions yet' : 'Could not load versions'}</h2>
          <p>
            {historyState === 'empty'
              ? 'Saved checkpoints will appear here. Return to your document to keep working.'
              : historyState === 'error'
                ? 'Your live document is unchanged. Try loading its versions again.'
                : 'Your live document remains available.'}
          </p>
          {historyState === 'error' && (
            <Button onClick={() => setHistoryState('ready')}>Try again</Button>
          )}
        </div>
      )}
      <p role="status">{notice}</p>
      <NameVersionDialog
        open={naming && !viewOnly}
        onOpenChange={setNaming}
        disabled={saveState !== 'saved' || offline || historyState !== 'ready'}
        onSave={(version) => {
          setCurrentName(version);
          setSelected(`Just now · ${version}`);
          onNameVersion?.(version);
          setNotice(`Version named ${version}.`);
        }}
      />
      <Modal
        icon="history"
        title={`Restore ${selected.startsWith('October') ? selectedLabel : `October 20, 2026 · ${selectedLabel}`} for everyone?`}
        description="The current document will be kept as a Before restore checkpoint. Other open editors will need to reload."
        open={restore && !viewOnly}
        onOpenChange={setRestore}
      >
        <div className="sp-actions">
          <Button onClick={() => setRestore(false)}>Cancel</Button>
          <Button
            primary
            disabled={offline || saveState !== 'saved' || historyState !== 'ready'}
            onClick={() => {
              setRestore(false);
              setNotice('Version restored in the preview.');
            }}
          >
            Restore version
          </Button>
        </div>
      </Modal>
    </Shell>
  );
}
export function ProfileMockup({
  section = 'profile',
  state = 'ready',
  initialPicker,
  onBack,
  onSignOut,
  operator = false,
  returnLabel = 'Back to files',
  credential = 'idle',
  onCredential,
}: {
  state?: 'ready' | 'loading' | 'load-error' | 'saving' | 'save-error';
  onBack?: () => void;
  onSignOut?: () => void;
  operator?: boolean;
  returnLabel?: string;
  credential?: 'idle' | 'pending' | 'success' | 'error';
  onCredential?: (next: 'idle' | 'pending' | 'success' | 'error') => void;
  initialPicker?: 'icon' | 'color';
  section?: 'profile' | 'security' | 'connections' | 'device' | 'links';
}) {
  const [tab, setTab] = useState<string>(section);
  const [profileState, setProfileState] = useState(state);
  const theme = useSyncExternalStore(watchTheme, getPreference);
  const [notice, setNotice] = useState('');
  const identity = useContext(ReviewProfileContext);
  const [draft, setDraft] = useState(identity.profile);
  const [saved, setSaved] = useState(identity.profile);
  const [downloaded, setDownloaded] = useState(true);
  const [picker, setPicker] = useState(initialPicker);
  const iconTrigger = useRef<HTMLButtonElement>(null);
  const closeIcon = () => {
    setPicker(undefined);
    requestAnimationFrame(() => iconTrigger.current?.focus());
  };
  return (
    <Shell
      operator={operator}
      compact
      onSelect={(next) => {
        if (next === 'My files') onBack?.();
      }}
      accountAvatar={
        <Avatar color={saved.color}>
          <ProfileIcon icon={saved.icon} />
        </Avatar>
      }
    >
      <header className="rd-page-header">
        <div>
          <p className="rd-eyebrow">YOUR ACCOUNT</p>
          <h1>Settings</h1>
        </div>
        <div className="sp-actions">
          {onBack && <Button onClick={onBack}>{returnLabel}</Button>}
          <Button onClick={onSignOut}>Sign out</Button>
        </div>
      </header>
      <div className="rd-profile">
        <nav aria-label="Profile sections">
          {[
            ['profile', 'Profile'],
            ['security', 'Passkeys'],
            ['device', 'This device'],
            ...(!operator
              ? [
                  ['connections', 'Connected assistants'],
                  ['links', 'Guest links'],
                ]
              : []),
          ].map(([id, label]) => (
            <button
              className="rd-nav-item"
              key={id}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="rd-profile-content">
          {tab === 'profile' && profileState === 'loading' ? (
            <LoadingReview label="Loading your profile…" />
          ) : tab === 'profile' && profileState === 'load-error' ? (
            <div>
              <p role="alert">Could not load your profile. Try again.</p>
              <Button onClick={() => setProfileState('ready')}>Try again</Button>
            </div>
          ) : tab === 'profile' ? (
            <>
              <h2>Make yourself at home</h2>
              <p className="sp-muted">Your name and icon help collaborators recognize you.</p>
              <div className="rd-profile-identity">
                <Avatar color={draft.color}>
                  <ProfileIcon icon={draft.icon} />
                </Avatar>
                <div>
                  <strong>{draft.name}</strong>
                  <p className="sp-muted">
                    {operator ? 'Operator account · No document access' : 'Your everyday account'}
                  </p>
                </div>
                <button
                  disabled={profileState === 'saving'}
                  className="sp-control"
                  ref={iconTrigger}
                  onClick={() => setPicker('icon')}
                >
                  Choose icon
                </button>
                <Button disabled={profileState === 'saving'} onClick={() => setPicker('color')}>
                  Choose color
                </Button>
              </div>
              <label>
                Display name
                <input
                  disabled={profileState === 'saving'}
                  maxLength={80}
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              {profileState === 'save-error' && (
                <p role="alert">
                  Could not save your profile. Your changes are still here. Try again.
                </p>
              )}
              {profileState === 'saving' && <p role="status">Saving your profile…</p>}
              <div className="sp-actions">
                <Button
                  primary
                  disabled={!draft.name.trim() || profileState === 'saving'}
                  onClick={() => {
                    setProfileState('ready');
                    setSaved(draft);
                    identity.save(draft);
                    setNotice(
                      'Profile saved in this preview. Reopen your editors to update your presence.',
                    );
                  }}
                >
                  {profileState === 'saving' ? 'Saving…' : 'Save profile'}
                </Button>
              </div>
              <p className="sp-muted">
                Your name and icon appear in account-only documents. Documents with guest links keep
                generic identities.
              </p>
            </>
          ) : tab === 'security' ? (
            <>
              <h2>Your passkeys</h2>
              <p className="sp-muted">Sign in securely on your devices.</p>
              <div className="rd-setting-row">
                <span>
                  <strong>MacBook</strong>
                  <small>Last used today</small>
                </span>
              </div>
              {credential === 'success' && (
                <div className="rd-setting-row">
                  <span>
                    New passkey<small>Added just now</small>
                  </span>
                </div>
              )}
              <Button
                primary
                onClick={() =>
                  onCredential
                    ? onCredential('pending')
                    : setNotice('Passkey creation is available in the connected walkthrough.')
                }
              >
                Add a passkey
              </Button>
            </>
          ) : tab === 'links' ? (
            <>
              <h2>Guest links</h2>
              <p className="sp-muted">
                Planned · Only links on files you own appear here. Secret addresses are never
                listed.
              </p>
              <div className="rd-setting-row">
                <span>
                  <strong>Autumn plans</strong>
                  <small>Doc · Can view · Enabled Oct 18 · Expires Oct 25</small>
                </span>
                <ActionMenu
                  label="Autumn plans guest link actions"
                  actions={[
                    {
                      label: 'Change expiry…',
                      onClick: () =>
                        setNotice(
                          'Expiry options: never, one day, seven days or 30 days. Changing expiry keeps the same link.',
                        ),
                    },
                    {
                      label: 'Turn off link',
                      destructive: true,
                      onClick: () => setNotice('Guest link turned off in this preview.'),
                    },
                  ]}
                />
              </div>
            </>
          ) : tab === 'connections' ? (
            <>
              <ConnectionsReview />
              <details className="rd-section">
                <summary>Advanced: personal access tokens</summary>
                <TokenManager />
              </details>
            </>
          ) : (
            <>
              <section className="rd-section rd-device-appearance">
                <h2>Appearance on this device</h2>
                <p className="sp-muted">
                  Saved in this browser. Applies to members and guests; signing in does not change
                  it.
                </p>
                <AppearanceChoice
                  value={theme}
                  onChange={(v) => {
                    setNotice(
                      setPreference(v as 'system' | 'light' | 'dark')
                        ? ''
                        : 'Theme changed for this visit, but this browser could not save your preference.',
                    );
                  }}
                />
              </section>
              {!operator && (
                <>
                  <h2>Offline files</h2>
                  <p className="sp-muted">Downloaded files are available without a connection.</p>
                  <div className="rd-banner">
                    This browser may clear offline files when space runs low.
                  </div>
                  <div className="rd-setting-row">
                    <span>
                      Quarterly budget{' '}
                      <small>
                        {downloaded
                          ? 'Available offline · 84 KB'
                          : 'Online only · Removed from this device'}
                      </small>
                    </span>
                    <Button disabled={!downloaded} onClick={() => setDownloaded(false)}>
                      Remove from device
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
          <p className="rd-feedback" role="status">
            {notice}
          </p>
        </div>
      </div>
      {(credential === 'pending' || credential === 'error') && (
        <section className="rd-section">
          <h2>Add a passkey</h2>
          <p role={credential === 'error' ? 'alert' : 'status'}>
            {credential === 'error'
              ? 'The passkey was not added. Your existing passkeys still work.'
              : 'Continue in your browser or device’s passkey prompt.'}
          </p>
          <div className="sp-actions">
            <Button onClick={() => onCredential?.('idle')}>Cancel</Button>
            {credential === 'error' && (
              <Button primary onClick={() => onCredential?.('pending')}>
                Try again
              </Button>
            )}
          </div>
        </section>
      )}
      {picker === 'icon' && (
        <IconPicker
          value={draft.icon}
          close={closeIcon}
          choose={(icon) => {
            setDraft({ ...draft, icon });
            closeIcon();
          }}
        />
      )}
      <Modal
        icon="palette"
        title="Choose your profile color"
        description="Use the same sixteen profile presets available in Spinel."
        open={picker === 'color'}
        onOpenChange={(open) => {
          if (!open) setPicker(undefined);
        }}
      >
        <div className="rd-profile-colors">
          {fillPresets.map((preset) => (
            <Button
              key={preset.id}
              aria-label={preset.label}
              title={preset.label}
              aria-pressed={draft.color === preset.id}
              style={{
                background: `var(--fill-${preset.id}-bg)`,
                color: `var(--fill-${preset.id}-fg)`,
              }}
              onClick={() => {
                setDraft({ ...draft, color: preset.id });
                setPicker(undefined);
              }}
            >
              <ProfileIcon icon={draft.icon} />
            </Button>
          ))}
        </div>
      </Modal>
    </Shell>
  );
}
export function AdminMockup({
  state = 'ready',
  section = 'People',
  firstRun = false,
  onProfile,
}: {
  firstRun?: boolean;
  onProfile?: () => void;
  state?:
    | 'ready'
    | 'loading'
    | 'error'
    | 'invite-created'
    | 'health-warning'
    | 'health-running'
    | 'health-failed'
    | 'health-unconfigured'
    | 'health-load-error'
    | 'health-loading'
    | 'health-never-run'
    | 'disable'
    | 'disable-pending'
    | 'disable-error'
    | 'passkeys'
    | 'operator-passkey'
    | 'operator-multiple-passkeys'
    | 'passkey-confirm'
    | 'passkey-pending'
    | 'passkey-error'
    | 'invite-pending'
    | 'invite-error'
    | 'invite-statuses'
    | 'revoke-pending'
    | 'revoke-error'
    | 'accounts-varied';
  section?: string;
}) {
  const [tab, setTab] = useState(section);
  const [accountsRetried, setAccountsRetried] = useState(false);
  const [healthRetried, setHealthRetried] = useState(false);
  const health = healthRetried ? 'ready' : state;
  const [confirm, setConfirm] = useState(state.startsWith('disable') ? 'Alex Kim' : '');
  const [passkeys, setPasskeys] = useState(
    state.startsWith('operator-')
      ? 'Operator (you)'
      : state.startsWith('passkey')
        ? 'Alex Kim'
        : '',
  );
  const [removePasskey, setRemovePasskey] = useState(
    ['passkey-confirm', 'passkey-pending', 'passkey-error'].includes(state),
  );
  const [removedPasskeys, setRemovedPasskeys] = useState<string[]>(
    state === 'accounts-varied' ? ['Alex Kim'] : [],
  );
  const [created, setCreated] = useState(state === 'invite-created');
  const [inviteOpen, setInviteOpen] = useState(['invite-pending', 'invite-error'].includes(state));
  const [purpose, setPurpose] = useState(state === 'invite-error' ? 'Alex Kim' : 'new');
  const [expiry, setExpiry] = useState(state === 'invite-error' ? '24' : '168');
  const [issued, setIssued] = useState({ purpose: 'new', expiry: '168' });
  const [revoked, setRevoked] = useState(false);
  const [disabled, setDisabled] = useState<string[]>(
    state === 'accounts-varied' ? ['Sam Rivera'] : [],
  );
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState(
    ['invite-error', 'disable-error', 'passkey-error', 'revoke-error'].includes(state) ? state : '',
  );
  const pending = state.endsWith('-pending');
  const sectionLabel =
    tab === 'People'
      ? 'accounts'
      : tab === 'Invites'
        ? 'invites'
        : tab === 'Connections'
          ? 'connections'
          : 'backup status';
  return (
    <Shell
      operator
      compact
      onSelect={(next) => {
        if (next === 'Your profile') onProfile?.();
      }}
    >
      <header className="rd-page-header">
        <div>
          <p className="rd-eyebrow">SERVER OPERATOR</p>
          <h1>Administration</h1>
        </div>
        {tab === 'Invites' && (
          <Button
            primary={!created}
            disabled={pending || state === 'loading' || (state === 'error' && !accountsRetried)}
            onClick={() => {
              setActionError('');
              setInviteOpen(true);
            }}
          >
            Create invite
          </Button>
        )}
      </header>
      <div className="rd-profile">
        <nav aria-label="Administration sections">
          {['People', 'Invites', 'Connections', 'Backups & health'].map((x) => (
            <button
              key={x}
              className="rd-nav-item"
              aria-current={tab === x ? 'page' : undefined}
              onClick={() => setTab(x)}
            >
              {x}
            </button>
          ))}
        </nav>
        <div className="rd-profile-content">
          <h2>{tab}</h2>
          <p className="sp-muted">Manage the instance. Document content stays private.</p>
          {firstRun && tab === 'People' && (
            <section className="rd-section">
              <h3>Your workspace is ready</h3>
              <p>
                Invite a separate everyday account to create and open documents. This Operator
                account manages access and backups.
              </p>
              <Button onClick={() => setTab('Invites')}>Invite your everyday account</Button>
            </section>
          )}
          {state === 'loading' ? (
            <LoadingReview label={`Loading ${sectionLabel}…`} />
          ) : state === 'error' && !accountsRetried ? (
            <div role="alert">
              <p>Could not load {sectionLabel}. Try again.</p>
              <Button onClick={() => setAccountsRetried(true)}>Try again</Button>
            </div>
          ) : tab === 'People' ? (
            (firstRun
              ? ['Operator (you)']
              : [
                  'Operator (you)',
                  'Alex Baylee',
                  'Alex Kim',
                  ...(state === 'accounts-varied' ? ['Sam Rivera'] : []),
                ]
            ).map((person) => (
              <div
                className="rd-setting-row"
                role="group"
                aria-label={`${person} account`}
                key={person}
              >
                <span>
                  <strong>{person}</strong>
                  <small>
                    {person.startsWith('Operator')
                      ? 'Operator · Protected account'
                      : disabled.includes(person)
                        ? 'Member · Disabled'
                        : `Member · Active · ${removedPasskeys.includes(person) ? 'No passkeys' : '1 passkey'}`}
                  </small>
                </span>
                <ActionMenu
                  label={`Actions for ${person}`}
                  actions={[
                    {
                      label: 'Manage passkeys',
                      onClick: () => {
                        setActionError('');
                        setRemovePasskey(false);
                        setPasskeys(person);
                      },
                    },
                    {
                      label: 'Create recovery invite…',
                      disabled: disabled.includes(person),
                      onClick: () => {
                        setActionError('');
                        setPurpose(person);
                        setInviteOpen(true);
                        setTab('Invites');
                      },
                    },
                    {
                      label: 'Disable account…',
                      destructive: true,
                      disabled: person.startsWith('Operator') || disabled.includes(person),
                      onClick: () => {
                        setActionError('');
                        setConfirm(person);
                      },
                    },
                  ]}
                />
              </div>
            ))
          ) : tab === 'Invites' ? (
            <>
              {created && (
                <section className="rd-section">
                  <h3>Invite ready</h3>
                  <p>Copy this address now. It is shown only once.</p>
                  <label>
                    Invitation address
                    <input readOnly value="https://spinel.example/invite#preview" />
                  </label>
                  <Button
                    primary
                    onClick={() =>
                      setNotice(
                        'Copied in this preview. If copying fails, select and copy the address above.',
                      )
                    }
                  >
                    Copy invite
                  </Button>
                  <p className="sp-muted">
                    If copying is unavailable, select the address and copy it manually.
                  </p>
                </section>
              )}
              {firstRun && !created && !revoked ? (
                <p>No invites yet. Create one for your everyday account.</p>
              ) : (
                <div className="rd-setting-row">
                  <span>
                    {issued.purpose === 'new' ? 'New account invite' : `Recover ${issued.purpose}`}
                    <small>
                      {revoked
                        ? 'Revoked'
                        : `Available · Expires in ${{ '1': '1 hour', '24': '1 day', '168': '7 days', '720': '30 days' }[issued.expiry]}`}
                    </small>
                  </span>
                  {!revoked && (
                    <Button
                      disabled={pending}
                      onClick={() => {
                        setRevoked(true);
                        setCreated(false);
                        setActionError('');
                        setNotice('Invite revoked in this preview.');
                      }}
                    >
                      {state === 'revoke-pending'
                        ? 'Revoking…'
                        : actionError === 'revoke-error'
                          ? 'Try again'
                          : 'Revoke'}
                    </Button>
                  )}
                </div>
              )}
              {state === 'revoke-pending' && <p role="status">Revoking the invitation…</p>}
              {actionError === 'revoke-error' && (
                <p role="alert">
                  Could not revoke the invitation. It is still available. Try again.
                </p>
              )}
              {state === 'invite-statuses' && (
                <div role="list" aria-label="Past invitations">
                  {[
                    ['New account invite', 'Used by Alex Kim · Expired October 19, 2026'],
                    ['Recover Alex Baylee', 'Expired October 18, 2026 · Not used'],
                    ['New account invite', 'Revoked · Expires October 25, 2026'],
                  ].map(([title, status]) => (
                    <div className="rd-setting-row" role="listitem" key={status}>
                      <span>
                        <strong>{title}</strong>
                        <small>{status}</small>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : tab === 'Connections' ? (
            <>
              <ConnectionsReview admin />
              <details className="rd-section">
                <summary>Personal access token activity</summary>
                <TokenManager admin />
              </details>
            </>
          ) : (
            <>
              {health === 'health-loading' ? (
                <LoadingReview label="Loading backup status…" />
              ) : health === 'health-load-error' ? (
                <div>
                  <p role="alert">Could not load backup status. Try again.</p>
                  <Button onClick={() => setHealthRetried(true)}>Try again</Button>
                </div>
              ) : (
                <div className="rd-setting-row">
                  <span>
                    <strong>
                      {firstRun || health === 'health-never-run'
                        ? 'No backups yet'
                        : health === 'health-warning'
                          ? 'Backup overdue'
                          : health === 'health-running'
                            ? 'Backup in progress…'
                            : health === 'health-failed'
                              ? 'Last backup failed'
                              : health === 'health-unconfigured'
                                ? 'Offsite backups are not configured'
                                : '✓ Backups are current'}
                    </strong>
                    <small>
                      {firstRun || health === 'health-never-run' || health === 'health-unconfigured'
                        ? 'Last successful backup: none yet'
                        : health === 'health-warning' || health === 'health-failed'
                          ? 'Last successful backup: Oct 18 at 03:00 · Checked today at 12:30'
                          : 'Last successful backup: today at 03:00'}
                    </small>
                    {health === 'health-running' && (
                      <small role="status">
                        The previous successful backup remains available while this one runs.
                      </small>
                    )}
                    {health === 'health-failed' && (
                      <small role="alert">
                        Last attempt: today at 03:00. Check the backup job on the server and retry
                        there.
                      </small>
                    )}
                    {(health === 'health-unconfigured' || firstRun) && (
                      <small role="alert">
                        Follow the backup setup guide on the server before adding your work.
                      </small>
                    )}
                  </span>
                  <a
                    className="sp-control"
                    href="https://github.com/mxbaylee/spinel/blob/main/docs/backups.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Backup guide
                  </a>
                </div>
              )}
              <div className="rd-setting-row">
                <span>
                  <strong>Server telemetry</strong>
                  <small>Planned · Disk, memory and connection health</small>
                </span>
              </div>
            </>
          )}
          <p className="rd-feedback" role="status">
            {notice}
          </p>
        </div>
      </div>
      <Modal
        icon="person"
        title="Create an invitation"
        description="Give someone access, or help an existing account recover its passkeys."
        open={inviteOpen}
        dismissDisabled={pending}
        onOpenChange={(open) => {
          if (!pending) setInviteOpen(open);
        }}
      >
        <div className="rd-form">
          <Choice
            label="Invite for"
            disabled={pending}
            value={purpose}
            onChange={setPurpose}
            options={[
              { value: 'new', label: 'A new everyday account' },
              ...['Operator (you)', ...(!firstRun ? ['Alex Baylee', 'Alex Kim'] : [])]
                .filter((person) => !disabled.includes(person))
                .map((person) => ({ value: person, label: `Recover ${person}` })),
            ]}
          />
          <Choice
            label="Expires in"
            disabled={pending}
            value={expiry}
            onChange={setExpiry}
            options={[
              { value: '1', label: '1 hour' },
              { value: '24', label: '1 day' },
              { value: '168', label: '7 days' },
              { value: '720', label: '30 days' },
            ]}
          />
          {purpose !== 'new' && (
            <p>
              Once accepted, recovery replaces this account’s old passkeys and signs out its other
              devices. Creating the invitation does not end access.
            </p>
          )}
          {actionError === 'invite-error' && (
            <p role="alert">
              Could not create the invitation. Your account and expiry choices are still here. Try
              again.
            </p>
          )}
          {state === 'invite-pending' && <p role="status">Creating the invitation…</p>}
          <div className="sp-actions">
            <Button disabled={pending} onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button
              primary
              disabled={pending}
              onClick={() => {
                setActionError('');
                setIssued({ purpose, expiry });
                setCreated(true);
                setRevoked(false);
                setInviteOpen(false);
                setNotice(
                  'Invitation created in this preview. No real account invitation was issued.',
                );
              }}
            >
              {state === 'invite-pending'
                ? 'Creating…'
                : actionError === 'invite-error'
                  ? 'Try again'
                  : 'Create invite'}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        icon="key"
        title={
          removePasskey
            ? `Remove MacBook from ${passkeys}?`
            : `Passkeys for ${passkeys || 'account'}`
        }
        description="Account credentials only; documents remain private."
        open={Boolean(passkeys)}
        dismissDisabled={pending}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setPasskeys('');
            setRemovePasskey(false);
          }
        }}
      >
        <p className="sp-muted">
          {passkeys.startsWith('Operator')
            ? state === 'operator-multiple-passkeys' && !removedPasskeys.includes(passkeys)
              ? 'You can remove MacBook while the security key remains. The Operator must keep at least one passkey.'
              : 'The Operator’s last passkey cannot be removed here.'
            : 'If their last passkey is removed, issue a recovery invitation so they can sign in again.'}
        </p>
        {removePasskey ? (
          <>
            <p>
              This passkey will stop working, and sessions signed in with it will end. A synced
              passkey may be used on several devices. Older sessions that cannot be linked to a
              passkey will also be signed out.
            </p>
            {actionError === 'passkey-error' && (
              <p role="alert">
                Could not remove MacBook. The passkey and its sessions are unchanged. Try again.
              </p>
            )}
            {state === 'passkey-pending' && <p role="status">Removing MacBook…</p>}
            <div className="sp-actions">
              <Button
                disabled={pending}
                onClick={() => {
                  setRemovePasskey(false);
                  setActionError('');
                }}
              >
                Cancel
              </Button>
              <Button
                primary
                disabled={
                  pending ||
                  (passkeys.startsWith('Operator') && state !== 'operator-multiple-passkeys')
                }
                onClick={() => {
                  setRemovedPasskeys((current) => [...current, passkeys]);
                  setRemovePasskey(false);
                  setActionError('');
                  setNotice(
                    `MacBook removed from ${passkeys} in this preview. No real credentials or sessions changed.`,
                  );
                  setPasskeys('');
                }}
              >
                {state === 'passkey-pending'
                  ? 'Removing…'
                  : actionError === 'passkey-error'
                    ? 'Try again'
                    : 'Remove passkey'}
              </Button>
            </div>
          </>
        ) : removedPasskeys.includes(passkeys) &&
          !(passkeys.startsWith('Operator') && state === 'operator-multiple-passkeys') ? (
          <p role="status">
            No passkeys remain. Create a recovery invitation for this active account.
          </p>
        ) : (
          <>
            {!removedPasskeys.includes(passkeys) && (
              <div className="rd-setting-row">
                <span>
                  MacBook<small>iCloud Keychain · Last used today · Added October 18</small>
                </span>
                <Button
                  disabled={
                    passkeys.startsWith('Operator') && state !== 'operator-multiple-passkeys'
                  }
                  onClick={() => {
                    setActionError('');
                    setRemovePasskey(true);
                  }}
                >
                  Remove…
                </Button>
              </div>
            )}
            {passkeys.startsWith('Operator') && state === 'operator-multiple-passkeys' && (
              <div className="rd-setting-row">
                <span>
                  Security key<small>USB security key · Added October 17</small>
                </span>
                <span className="rd-badge">
                  {removedPasskeys.includes(passkeys)
                    ? 'Last passkey · Protected'
                    : 'Kept for sign-in'}
                </span>
              </div>
            )}
          </>
        )}
        <p className="sp-muted rd-passkey-preview-note">
          Design preview. No real credentials or sessions are changed.
        </p>
      </Modal>
      <Modal
        icon="warning"
        title={`Disable ${confirm || 'this account'}?`}
        description="Their sessions end now. Their documents and shares are kept."
        open={Boolean(confirm)}
        dismissDisabled={pending}
        onOpenChange={(open) => {
          if (!open && !pending) setConfirm('');
        }}
      >
        {actionError === 'disable-error' && (
          <p role="alert">
            Could not disable {confirm}. The account is still active and its sessions are unchanged.
            Try again.
          </p>
        )}
        {state === 'disable-pending' && <p role="status">Disabling {confirm}…</p>}
        <div className="sp-actions">
          <Button disabled={pending} onClick={() => setConfirm('')}>
            Cancel
          </Button>
          <Button
            primary
            disabled={pending || confirm.startsWith('Operator')}
            onClick={() => {
              setDisabled([...disabled, confirm]);
              setActionError('');
              setNotice(`${confirm} disabled in this preview. No real account access changed.`);
              setConfirm('');
            }}
          >
            {state === 'disable-pending'
              ? 'Disabling…'
              : actionError === 'disable-error'
                ? 'Try again'
                : 'Disable account'}
          </Button>
        </div>
      </Modal>
    </Shell>
  );
}
export function EntryMockup({
  kind = 'consent',
  readOnly = false,
  consentState = 'ready',
  expireOnAllow = false,
  onManageConnections,
  onSignOut,
}: {
  onManageConnections?: () => void;
  onSignOut?: () => void;
  readOnly?: boolean;
  expireOnAllow?: boolean;
  consentState?:
    | 'ready'
    | 'loading'
    | 'load-error'
    | 'pending'
    | 'cancelling'
    | 'error'
    | 'operator'
    | 'malformed'
    | 'unavailable'
    | 'limit';
  kind?: 'revoked' | 'offline' | 'missing' | 'consent' | 'consent-expired';
}) {
  const [notice, setNotice] = useState('');
  const [requestState, setRequestState] = useState<string>(consentState);
  const consent = kind === 'consent';
  const busy = requestState === 'pending' || requestState === 'cancelling';
  const blocked = [
    'operator',
    'malformed',
    'unavailable',
    'cancelled',
    'loading',
    'load-error',
    'expired',
  ].includes(requestState);
  const entries = {
    revoked: ['This link no longer works.', 'Ask the person who shared it for a new link.', ''],
    offline: ['You’re offline.', 'Connect to the internet to open this page.', 'Try again'],
    missing: [
      'This item isn’t available.',
      'It may have moved, or you may no longer have access.',
      'Go to My files',
    ],
    consent: [
      'Allow this connection?',
      'Only continue if you started this connection yourself.',
      'Allow connection',
    ],
    'consent-expired': [
      'This request has expired.',
      'Return to the application and start connecting again.',
      '',
    ],
  };
  const [title, detail, action] = entries[kind];
  const unavailableDetail: Record<string, string> = {
    operator:
      'Operator accounts cannot connect assistants. Sign out and use your everyday account.',
    malformed:
      'This connection request has expired or is no longer available. Start again from your application.',
    unavailable:
      'This connection request is not available in this session. Start again from your application.',
    cancelled: 'Connection cancelled in this preview. Return to your application.',
    expired:
      'This request expired before access was granted. Return to your application and start connecting again.',
  };
  return (
    <div className="sp-ui rd-entry">
      <header className="rd-entry-header">
        <div className="rd-entry-brand">
          <GemLogo />
          <strong>spinel</strong>
        </div>
        <ThemeMenu />
      </header>
      <section className="rd-entry-card">
        <h1>{consent && blocked ? 'Connect an application' : title}</h1>
        {consent && blocked ? (
          requestState === 'loading' ? (
            <LoadingReview label="Loading connection request…" />
          ) : requestState === 'load-error' ? (
            <>
              <p role="alert">Could not load this connection request. Try again.</p>
              <Button onClick={() => setRequestState('ready')}>Try again</Button>
            </>
          ) : (
            <p role={requestState === 'cancelled' ? 'status' : 'alert'}>
              {unavailableDetail[requestState]}
            </p>
          )
        ) : (
          <p className="sp-muted">{detail}</p>
        )}
        {consent && !blocked && (
          <div className="rd-consent">
            <p>
              <strong>Notebook client</strong>
              <small>Client-supplied name · not verified</small>
            </p>
            <p>
              Return address: <strong>client.example</strong>
            </p>
            <p>
              {readOnly
                ? 'Can read files you can access. Cannot edit files.'
                : 'Can read files you can access and edit only files you have permission to edit.'}
            </p>
            <p>
              You can disconnect this application in Settings → Connected assistants at any time.
            </p>
            <p>Signed in as Alex Baylee</p>
          </div>
        )}
        {consent && requestState === 'error' && (
          <p role="alert">Could not finish this connection request. Try again.</p>
        )}
        {consent && requestState === 'limit' && (
          <>
            <p role="alert">
              You have 10 connected assistants. Disconnect an old assistant in Settings, then start
              again from your application.
            </p>
            {onManageConnections && (
              <Button primary onClick={onManageConnections}>
                Manage connected assistants
              </Button>
            )}
          </>
        )}
        {consent && requestState === 'operator' && onSignOut && (
          <Button primary onClick={onSignOut}>
            Sign out
          </Button>
        )}
        {action && (!consent || !blocked) && (
          <div className="sp-actions">
            <Button
              primary
              disabled={consent && (busy || requestState === 'limit')}
              onClick={() =>
                consent
                  ? setRequestState(expireOnAllow ? 'expired' : 'pending')
                  : setNotice('Continue in the application.')
              }
            >
              {action}
            </Button>
            {consent && (
              <Button disabled={busy} onClick={() => setRequestState('cancelled')}>
                Cancel
              </Button>
            )}
          </div>
        )}
        {consent && busy && <p role="status">Finishing connection request…</p>}
        <p className="rd-feedback" role="status">
          {notice}
        </p>
      </section>
      <footer>Private by invitation. Yours to make.</footer>
    </div>
  );
}
