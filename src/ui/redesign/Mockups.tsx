/** SPN-047 review prototypes. No production routes, network calls or document writes. */
import { useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { GemLogo } from '../GemLogo.tsx';
import { EntityIcon } from '../EntityIcon.tsx';
import { getPreference, setPreference, watchTheme } from '../theme.ts';
import { ActionMenu, Button, Choice, DetailsPopover, Modal, SegmentedChoice } from './Controls.tsx';
import './mockups.css';

type GlyphName =
  | 'files'
  | 'search'
  | 'folder'
  | 'shared'
  | 'trash'
  | 'pin'
  | 'back'
  | 'menu'
  | 'sun'
  | 'check'
  | 'shield'
  | 'download'
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
  pin: 'M8 3h8l-1 7 4 4H5l4-4z M12 14v8',
  back: 'M15 5l-7 7 7 7',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10 M12 1v2 M12 21v2 M1 12h2 M21 12h2 M4 4l2 2 M18 18l2 2 M4 20l2-2 M18 6l2-2',
  check: 'M5 12l4 4L19 6',
  shield: 'M12 2l8 4v6c0 5-8 10-8 10S4 17 4 12V6z',
  network: 'M2 8q10-8 20 0 M5 12q7-6 14 0 M8 16q4-4 8 0 M12 20h.01',
  'network-off': 'M2 8q10-8 20 0 M5 12q7-6 14 0 M8 16q4-4 8 0 M12 20h.01 M3 3l18 18',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
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
function Avatar({ children = 'AB' }: { children?: ReactNode }) {
  return <span className="rd-avatar">{children}</span>;
}
export function AppearanceChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <SegmentedChoice
      label="Appearance"
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={[
        { value: 'system', label: 'Follow system', icon: <Glyph name="monitor" /> },
        { value: 'light', label: 'Light', icon: <Glyph name="sun" /> },
        { value: 'dark', label: 'Dark', icon: <Glyph name="moon" /> },
      ]}
    />
  );
}
function ThemeMenu({ labelled = false }: { labelled?: boolean }) {
  const preference = useSyncExternalStore(watchTheme, getPreference);
  const [error, setError] = useState('');
  const control = (
    <>
      <AppearanceChoice
        value={preference}
        onChange={(value) =>
          setError(
            setPreference(value as 'system' | 'light' | 'dark')
              ? ''
              : 'Theme changed for this visit. Your preference could not be saved.',
          )
        }
      />
      {error && <span role="alert">{error}</span>}
    </>
  );
  return labelled ? (
    <div className="rd-appearance-row">
      <span>Appearance</span>
      {control}
    </div>
  ) : (
    <DetailsPopover
      label={`Appearance: ${preference}`}
      trigger={
        <Glyph
          name={preference === 'system' ? 'monitor' : preference === 'dark' ? 'moon' : 'sun'}
        />
      }
    >
      {control}
    </DetailsPopover>
  );
}
function NetworkStatus({ offline = false }: { offline?: boolean }) {
  return (
    <DetailsPopover
      label={offline ? 'Offline — not connected to Spinel' : 'Online — connected to Spinel'}
      hover
      trigger={<Glyph name={offline ? 'network-off' : 'network'} />}
    >
      <p>
        {offline
          ? 'You are offline. Open files may have changes waiting to sync. Check their save status before closing.'
          : 'Connected to Spinel. Open save status for details about this document.'}
      </p>
    </DetailsPopover>
  );
}
function Sidebar({
  space = false,
  selected,
  onSelect,
  guest = false,
  canEdit = true,
  onCollapse,
  offline = false,
}: {
  offline?: boolean;
  onCollapse?: () => void;
  canEdit?: boolean;
  space?: boolean;
  selected: string;
  onSelect: (view: string) => void;
  guest?: boolean;
}) {
  const [action, setAction] = useState('');
  const [destination, setDestination] = useState('root');
  const groups: { title: string; items: [string, GlyphName][] }[] = space
    ? [
        {
          title: 'AUTUMN PLANS',
          items: [
            ['Overview', 'files'],
            ['Budget', 'files'],
            ['Places to stay', 'files'],
          ],
        },
        {
          title: 'WEEKEND TRIP',
          items: [
            ['Packing list', 'files'],
            ['Reservations', 'files'],
          ],
        },
      ]
    : [
        {
          title: 'WORKSPACE',
          items: [
            ['My files', 'files'],
            ['Shared with me', 'shared'],
          ],
        },
        {
          title: 'PINNED',
          items: [
            ['Quarterly budget', 'pin'],
            ['Autumn plans', 'pin'],
          ],
        },
      ];
  return (
    <nav className="rd-sidebar" aria-label={space ? 'Space contents' : 'Files'}>
      {onCollapse && (
        <div className="rd-sidebar-brand">
          <div className="rd-brand">
            <GemLogo />
          </div>
          <NetworkStatus offline={offline} />
          <Button aria-label="Collapse navigation" onClick={onCollapse}>
            <Glyph name="back" />
          </Button>
        </div>
      )}
      {groups.map((group) => (
        <section key={group.title}>
          {space && group.title === 'WEEKEND TRIP' ? (
            <details open>
              <summary>Weekend trip</summary>
              <div className="rd-tree-nested">
                {group.items.map(([label, glyph]) => (
                  <div className="rd-tree-row" key={label}>
                    <button
                      className="rd-nav-item"
                      aria-current={selected === label ? 'page' : undefined}
                      onClick={() => onSelect(label)}
                    >
                      <Glyph name={glyph} />
                      {label}
                    </button>
                    {canEdit && (
                      <ActionMenu
                        label={`Page actions for ${label}`}
                        actions={['Rename', 'Move or reorder', 'Trash'].map((x) => ({
                          label: x,
                          onClick: () => setAction(`${x}: ${label}`),
                        }))}
                      />
                    )}
                  </div>
                ))}
              </div>
            </details>
          ) : (
            <>
              <h2>{group.title}</h2>
              {group.items.map(([label, glyph]) => (
                <div className="rd-tree-row" key={label}>
                  <button
                    className="rd-nav-item"
                    aria-current={selected === label ? 'page' : undefined}
                    onClick={() => onSelect(label)}
                  >
                    {!space && glyph === 'pin' ? (
                      <span aria-hidden="true">{filenameEmoji(label)}</span>
                    ) : (
                      <Glyph name={glyph} />
                    )}
                    {label}
                  </button>
                  {space && canEdit && (
                    <ActionMenu
                      label={`Page actions for ${label}`}
                      actions={['Rename', 'Move or reorder', 'Trash'].map((x) => ({
                        label: x,
                        destructive: x === 'Trash',
                        onClick: () => setAction(`${x}: ${label}`),
                      }))}
                    />
                  )}
                </div>
              ))}
            </>
          )}
        </section>
      ))}
      {space && canEdit && (
        <ActionMenu
          label="Add page"
          actions={['Doc', 'Sheet'].map((x) => ({
            label: x,
            onClick: () => setAction(`New ${x}`),
          }))}
        >
          ＋ Add page
        </ActionMenu>
      )}
      <Modal
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
      {!guest && (
        <div className="rd-sidebar-bottom">
          {onCollapse && !guest && (
            <div className="rd-sidebar-utilities">
              <ThemeMenu labelled />
              <Button onClick={() => onSelect('Your profile')}>
                <Avatar /> Your profile
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
  guest = false,
  operator = false,
  canEdit = true,
  selected = 'My files',
  onSelect = () => {},
  collapsed = false,
  compact = false,
  offline = false,
}: {
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
              : '.rd-rail-button',
        )
        ?.focus(),
    );
  };
  return (
    <div
      ref={shellRef}
      className={`sp-ui rd-shell ${sidebar && expanded ? 'rd-with-sidebar' : ''} ${guest ? 'rd-guest' : ''} ${compact ? 'rd-compact-shell' : ''} ${sidebar ? 'rd-has-navigation' : ''}`}
    >
      {!guest && (
        <aside className="rd-rail" aria-label="Global navigation">
          <div className="rd-brand">
            <GemLogo />
          </div>
          <NetworkStatus offline={offline} />
          <button
            className="rd-rail-button"
            aria-label={
              sidebar
                ? space
                  ? 'Browse pages'
                  : 'Browse files'
                : operator
                  ? 'Administration'
                  : 'My files'
            }
            onClick={() => {
              if (sidebar) {
                if (window.matchMedia('(max-width: 900px)').matches) setNav(true);
                else setNavigation(!expanded);
              } else onSelect('My files');
            }}
          >
            <Glyph name={sidebar ? 'menu' : operator ? 'shield' : 'files'} />
            {sidebar && <small>{space ? 'Pages' : 'Files'}</small>}
          </button>
          {sidebar && !space && (
            <nav className="rd-collapsed-destinations" aria-label="File shortcuts">
              {(
                [
                  ['My files', 'files'],
                  ['Shared with me', 'shared'],
                  ['Quarterly budget', 'pin'],
                  ['Autumn plans', 'pin'],
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
                  {glyph === 'pin' ? (
                    <span aria-hidden="true">{filenameEmoji(label)}</span>
                  ) : (
                    <Glyph name={glyph} />
                  )}
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
              className="rd-rail-button"
              aria-label="Your profile"
              onClick={() => onSelect('Your profile')}
            >
              <Avatar />
            </button>
          </div>
        </aside>
      )}
      {sidebar && (
        <>
          {expanded && (
            <div className="rd-desktop-nav">
              <Sidebar
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
            title={space ? 'Space contents' : 'Browse files'}
            description="Choose where to go."
            open={nav}
            onOpenChange={setNav}
          >
            <Sidebar
              space={space}
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
      <main className="rd-main">{children}</main>
    </div>
  );
}
const files = [
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
];
export function DashboardMockup({
  state = 'populated',
  collapsed = false,
  initialLayout = 'list',
}: {
  initialLayout?: 'list' | 'grid';
  collapsed?: boolean;
  state?:
    | 'populated'
    | 'empty'
    | 'loading'
    | 'error'
    | 'search'
    | 'filtered'
    | 'no-results'
    | 'trash'
    | 'shared'
    | 'folder';
}) {
  const [view, setView] = useState(
    state === 'trash'
      ? 'Trash'
      : state === 'shared'
        ? 'Shared with me'
        : state === 'folder'
          ? 'Household'
          : 'My files',
  );
  const [search, setSearch] = useState(
    state === 'search' ? 'budget' : state === 'no-results' ? 'winter' : '',
  );
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('all');
  const [filtersOpen, setFiltersOpen] = useState(state === 'filtered');
  const [scope, setScope] = useState('all');
  const [tag, setTag] = useState(state === 'filtered' ? 'household' : '');
  const [modified, setModified] = useState('any');
  const [removed, setRemoved] = useState<string[]>([]);
  const [layout, setLayout] = useState(initialLayout);
  if (view === 'Your profile') return <ProfileMockup />;
  const rows = files.filter(
    (file) =>
      file.name.toLowerCase().includes(search.toLowerCase()) &&
      (kind === 'all' || file.kind === kind) &&
      (!tag || file.tags.includes(tag)) &&
      (scope === 'all' ||
        (scope === 'shared' ? file.access !== 'owner' : file.access === 'owner')) &&
      (modified === 'any' || file.date.includes('ago')) &&
      !removed.includes(file.name) &&
      (!files.some((item) => item.name === view && item.kind !== 'folder') || file.name === view) &&
      (view !== 'Shared with me' || file.access !== 'owner') &&
      (view !== 'Trash' || (file.access === 'owner' && file.kind !== 'folder')) &&
      (!['Household', 'Work', 'Trips'].includes(view) ||
        file.tags ===
          ({ Household: 'household', Work: 'work', Trips: 'travel' } as Record<string, string>)[
            view
          ]),
  );
  const empty = state === 'empty' || rows.length === 0;
  return (
    <Shell sidebar collapsed={collapsed} selected={view} onSelect={setView}>
      <header className="rd-page-header">
        <div>
          <h1>{view}</h1>
        </div>
        <div className="rd-header-actions">
          <ActionMenu
            label="New file"
            primary
            actions={['Doc', 'Sheet', 'Space', 'Folder', 'Import file…'].map((label) => ({
              label,
              onClick: () => setDialog(label),
            }))}
          >
            ＋ New <span aria-hidden="true">⌄</span>
          </ActionMenu>
        </div>
      </header>
      <div className="rd-content">
        <div className="rd-list-tools">
          <label className="rd-search">
            <Glyph name="search" />
            <input
              aria-label="Search files"
              placeholder={
                view === 'My files' ? 'Search all files' : `Search ${view.toLowerCase()}`
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
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
        </div>
        <div className="rd-filter-bar">
          <Button aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
            Filters {filtersOpen ? '⌃' : '⌄'}
          </Button>
          {(tag || scope !== 'all' || modified !== 'any' || kind !== 'all') && (
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
              <Button
                onClick={() => {
                  setTag('');
                  setScope('all');
                  setModified('any');
                  setKind('all');
                }}
              >
                Clear filters
              </Button>
            </>
          )}
        </div>
        {filtersOpen && (
          <div className="rd-advanced-filters">
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
            {view === 'Trash'
              ? 'Recover a file, or remove it permanently.'
              : search
                ? `Results for “${search}”`
                : `${rows.length} items`}
          </span>
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
          {view !== 'My files' && view !== 'Trash' && (
            <Button onClick={() => setView('My files')}>Search all files</Button>
          )}
        </div>
        {state === 'loading' ? (
          <div className="rd-empty" role="status">
            Loading your files…
          </div>
        ) : state === 'error' ? (
          <div className="rd-empty">
            <h2>Could not load your files.</h2>
            <p role="alert">Check your connection and try again.</p>
            <Button onClick={() => setNotice('Trying again…')}>Try again</Button>
          </div>
        ) : empty ? (
          <div className="rd-empty">
            <EntityIcon kind="doc" size={48} />
            <h2>{search ? 'No matching files' : 'Room for your next idea'}</h2>
            <p>
              {search
                ? 'Try another name or clear your filters.'
                : 'Choose New to start a Doc, Sheet or Space.'}
            </p>
            {search && (
              <Button
                onClick={() => {
                  setSearch('');
                  setKind('all');
                }}
              >
                Clear filters
              </Button>
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
              <span>Last edited</span>
              <span />
            </div>
            {rows.map((file) => (
              <div className="rd-file" role="listitem" key={file.name}>
                <button
                  className="rd-file-open"
                  onClick={() =>
                    file.kind === 'folder' ? setView(file.name) : setNotice(`Opening ${file.name}…`)
                  }
                >
                  <span className="rd-file-icon">
                    {file.kind === 'folder' ? (
                      <Glyph name="folder" />
                    ) : (
                      <FileIdentity kind={file.kind} emoji={filenameEmoji(file.name)} size={32} />
                    )}
                  </span>
                  <span>
                    <strong>{file.name}</strong>
                    <small>
                      {file.kind !== 'folder' &&
                        `${file.kind === 'doc' ? 'Doc' : file.kind === 'sheet' ? 'Sheet' : 'Space'} · `}
                      {file.detail}
                      {file.tags && ` · ${file.tags}`}
                    </small>
                  </span>
                </button>
                <span className="rd-file-date">{file.date}</span>
                <ActionMenu
                  label={`More actions for ${file.name}`}
                  actions={
                    view === 'Trash'
                      ? [
                          {
                            label: 'Restore',
                            onClick: () => {
                              setRemoved([...removed, file.name]);
                              setNotice(`${file.name} restored.`);
                            },
                          },
                          {
                            label: 'Delete permanently…',
                            destructive: true,
                            onClick: () => setDialog('Delete permanently'),
                          },
                        ]
                      : [
                          {
                            label: 'Open',
                            onClick: () =>
                              file.kind === 'folder'
                                ? setView(file.name)
                                : setNotice(`Opening ${file.name}…`),
                          },
                          { label: 'Pin', onClick: () => setNotice(`${file.name} pinned.`) },
                          { label: 'Tags…', onClick: () => setDialog('Tags') },
                          ...(file.access !== 'owner'
                            ? [
                                {
                                  label: 'File into folder…',
                                  onClick: () => setDialog('File into folder'),
                                },
                              ]
                            : ['Share…', 'Rename…', 'Move…'].map((label) => ({
                                label,
                                onClick: () => setDialog(label),
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
                                  onClick: () => {
                                    setRemoved([...removed, file.name]);
                                    setNotice(`${file.name} moved to Trash.`);
                                  },
                                },
                              ]
                            : []),
                        ]
                  }
                />
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
          {view === 'My files' && !search && (kind === 'all' || kind === 'folder') && !tag && (
            <div className="rd-file" role="listitem">
              <button className="rd-file-open" onClick={() => setView('Trash')}>
                <span className="rd-file-icon">
                  <Glyph name="trash" />
                </span>
                <span>
                  <strong>Trash</strong>
                  <small>Permanent folder · 3 deleted files</small>
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
      <Modal
        title={dialog || 'New file'}
        description="Changes in this review stay in the preview."
        open={Boolean(dialog)}
        onOpenChange={(open) => {
          if (!open) setDialog('');
        }}
      >
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled" />
        </label>
        <div className="sp-actions">
          <Button onClick={() => setDialog('')}>Cancel</Button>
          <Button
            primary
            onClick={() => {
              setNotice(`${dialog}: ${name || 'Untitled'}`);
              setDialog('');
            }}
          >
            Continue
          </Button>
        </div>
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
  initialPage = 'Overview',
}: {
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
  initialPage?: string;
}) {
  const [share, setShare] = useState(false);
  const [selected, setSelected] = useState(initialPage);
  const [checkpoint, setCheckpoint] = useState('10:15 · Ready for the trip');
  const [panel, setPanel] = useState(formula ? 'Formula' : '');
  const [notice, setNotice] = useState('');
  const name = title ?? (sheet ? 'Quarterly budget' : space ? selected : 'Autumn plans');
  return (
    <Shell
      sidebar={space}
      collapsed={collapsed}
      offline={offline}
      compact={!space}
      space={space}
      guest={guest}
      canEdit={!viewOnly}
      selected={selected}
      onSelect={setSelected}
    >
      <header className="rd-editor-header">
        <div className="rd-editor-title">
          {guest ? (
            <div className="rd-guest-gem">
              <GemLogo />
            </div>
          ) : (
            <Button
              className="sp-quiet"
              aria-label="Back to files"
              onClick={() =>
                setNotice('Return to your previous folder, search and scroll position.')
              }
            >
              <Glyph name="back" />
            </Button>
          )}
          <FileIdentity
            kind={space ? 'space' : sheet ? 'sheet' : 'doc'}
            emoji={filenameEmoji(space ? 'Autumn plans' : name)}
            size={24}
          />
          <div>
            <span className="rd-breadcrumb">
              {space
                ? 'Space · Autumn plans /'
                : guest
                  ? `${sheet ? 'Sheet' : 'Doc'} · Shared document`
                  : `${sheet ? 'Sheet' : 'Doc'} · Household /`}
            </span>
            <h1>{name}</h1>
          </div>
        </div>
        <div className="rd-status-slot">
          <DetailsPopover
            label={offline ? '↻ Waiting to sync' : viewOnly ? 'Connected' : '✓ Saved'}
          >
            <p>
              {offline
                ? 'Saved on this device. Your changes will sync when you reconnect.'
                : viewOnly
                  ? 'You can view this document. You’re connected.'
                  : 'All changes are saved. You’re connected.'}
            </p>
            {offline && <Button onClick={() => setNotice('Reconnecting…')}>Try again</Button>}
          </DetailsPopover>
        </div>
        <div className="rd-editor-actions">
          {!guest && !viewOnly && (
            <span className="rd-presence">
              <Avatar>AK</Avatar>
            </span>
          )}
          {guest || viewOnly || collaborator ? (
            <span className="rd-badge">
              {viewOnly ? 'View only' : guest ? 'Guest editor' : 'Can edit'}
            </span>
          ) : (
            <Button primary className="rd-desktop-share" onClick={() => setShare(true)}>
              Share
            </Button>
          )}
          {guest ? (
            <Button aria-label="Export as PDF" onClick={() => setNotice('Preparing PDF…')}>
              <Glyph name="download" /> PDF
            </Button>
          ) : (
            <ActionMenu
              label="Document actions"
              actions={[
                ...(!viewOnly && !collaborator
                  ? [{ label: 'Share…', onClick: () => setShare(true) }]
                  : []),
                ...(collaborator
                  ? [
                      {
                        label: 'About your access',
                        onClick: () =>
                          setNotice(
                            'You can edit this file. Its owner manages sharing. You can name and restore versions. Folder access may still apply.',
                          ),
                      },
                    ]
                  : []),
                ...[
                  'Versions',
                  'Export',
                  'Theatre mode',
                  ...(!viewOnly ? ['Insert formula', 'Fill presets'] : []),
                ].map((label) => ({ label, onClick: () => setPanel(label) })),
              ]}
            />
          )}
        </div>
      </header>
      {!viewOnly && (
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
      <div className="rd-editor-body">
        {selected === 'Trash' && space ? (
          <div className="rd-content">
            <h1>Space trash</h1>
            <p>These pages stay recoverable until permanently deleted.</p>
            <div className="rd-setting-row">
              <span>Old itinerary</span>
              <Button onClick={() => setNotice('Old itinerary restored to this Space.')}>
                Restore
              </Button>
            </div>
          </div>
        ) : (
          <DocumentSurface
            sheet={sheet || selected === 'Budget'}
            unavailable={guest || offline}
            readOnly={viewOnly}
            table={table}
          />
        )}
        {panel && (
          <aside className="rd-inspector">
            <div className="rd-modal-title">
              <h2>{panel}</h2>
              <Button aria-label="Close panel" onClick={() => setPanel('')}>
                ×
              </Button>
            </div>
            {panel.includes('formula') || panel === 'Formula' ? (
              <FormulaForm />
            ) : panel === 'Versions' ? (
              <HistoryContent selected={checkpoint} setSelected={setCheckpoint} />
            ) : (
              <>
                <p className="sp-muted">
                  {panel === 'Export' ? 'Choose a format for this document.' : 'Document options'}
                </p>
                {['Univer file', 'PDF'].map((label) => (
                  <Button key={label} onClick={() => setNotice(`Preparing ${label}…`)}>
                    {label}
                  </Button>
                ))}
              </>
            )}
          </aside>
        )}
      </div>
      <div className="rd-editor-foot" role="status">
        {notice ||
          (viewOnly ? 'You can view this document.' : 'All times shown in your local time.')}
      </div>
      <Modal
        title={`Share ${name}`}
        description="Choose who can open this file."
        open={share}
        onOpenChange={setShare}
      >
        <SharingContent />
      </Modal>
    </Shell>
  );
}
type SharingState = 'off' | 'created' | 'existing' | 'replace' | 'error';
function SharingContent({
  delegated = false,
  state = 'off',
}: {
  delegated?: boolean;
  state?: SharingState;
}) {
  const [role, setRole] = useState('edit');
  const [link, setLink] = useState(
    state === 'created' || state === 'existing' || state === 'replace',
  );
  const [revealed, setRevealed] = useState(state === 'created');
  const [linkRole, setLinkRole] = useState(state === 'created' ? 'edit' : 'view');
  const [activeRole, setActiveRole] = useState(linkRole);
  const [replace, setReplace] = useState(state === 'replace');
  const [notice, setNotice] = useState(
    state === 'error'
      ? 'Access could not be updated. Alex still has Can edit access. Try again.'
      : '',
  );
  return (
    <>
      <div className="rd-person">
        <Avatar />
        <span>
          <strong>You</strong>
          <small>Owner</small>
        </span>
        <span className="rd-badge">Owner</span>
      </div>
      <div className="rd-person">
        <Avatar>AK</Avatar>
        <span>
          <strong>Alex Kim</strong>
          <small>Can edit through a folder</small>
        </span>
        <Choice
          label="Alex’s direct access"
          value={role}
          onChange={(v) => {
            if (state === 'error') {
              setNotice('Access could not be updated. Alex still has Can edit access. Try again.');
            } else {
              setRole(v);
              setNotice('Access updated. Inherited folder access still applies.');
            }
          }}
          options={[
            { value: 'none', label: 'No direct access' },
            { value: 'view', label: 'Can view' },
            { value: 'edit', label: 'Can edit' },
            ...(delegated ? [{ value: 'admin', label: 'File admin' }] : []),
          ]}
        />
      </div>
      <section className="rd-section">
        <h3>Anyone with the link</h3>
        <p className="sp-muted">
          {link ? `Guests can ${activeRole}.` : 'Off. Only people with access can open this file.'}
        </p>
        <Choice
          label="Guest link access"
          value={linkRole}
          onChange={setLinkRole}
          options={[
            { value: 'view', label: 'Can view' },
            { value: 'edit', label: 'Can edit' },
          ]}
        />
        {link && revealed && (
          <label>
            Guest address
            <input readOnly value="https://spinel.example/share/preview#sample" />
          </label>
        )}
        {link && (
          <p className="sp-muted">
            {revealed
              ? 'Copy this address now. It is shown only once.'
              : 'Replace the link to copy a new address.'}
          </p>
        )}
        {link && activeRole !== linkRole && (
          <p>The current link stays unchanged until you replace it.</p>
        )}
        <div className="sp-actions">
          {link ? (
            <>
              {revealed && (
                <Button primary onClick={() => setNotice('Guest address copied in this preview.')}>
                  Copy guest link
                </Button>
              )}
              <ActionMenu
                label="Guest link actions"
                actions={[
                  { label: 'Replace link…', onClick: () => setReplace(true) },
                  {
                    label: 'Turn off link',
                    destructive: true,
                    onClick: () => {
                      setLink(false);
                      setRevealed(false);
                      setNotice('Guest link turned off.');
                    },
                  },
                ]}
              />
            </>
          ) : (
            <Button
              onClick={() => {
                setLink(true);
                setRevealed(true);
                setActiveRole(linkRole);
                setNotice('Guest link created for this preview.');
              }}
            >
              Create link
            </Button>
          )}
        </div>
        <Modal
          title="Replace the link?"
          description="The old link stops working at once, and anyone using it loses access."
          open={replace}
          onOpenChange={setReplace}
        >
          <p>The replacement lets guests {linkRole} this file.</p>
          <div className="sp-actions">
            <Button onClick={() => setReplace(false)}>Cancel</Button>
            <Button
              primary
              onClick={() => {
                setActiveRole(linkRole);
                setRevealed(true);
                setReplace(false);
                setNotice('Replacement created in this preview. The old link no longer works.');
              }}
            >
              Replace link
            </Button>
          </div>
        </Modal>
        <p className="sp-muted">Collaborator names are hidden while link sharing is on.</p>
      </section>
      <p role={state === 'error' ? 'alert' : 'status'} className="rd-feedback">
        {notice}
      </p>
      <div className="sp-actions">
        <Button onClick={() => setNotice('Account link copied in this preview.')}>
          Copy account link
        </Button>
      </div>
    </>
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
        <SharingContent delegated={delegated} state={state} />
      </section>
    </div>
  );
}
function FormulaForm({
  state = 'value',
}: {
  state?: 'value' | 'private' | 'offline' | 'invalid' | 'loading' | 'empty' | 'table';
}) {
  const [format, setFormat] = useState('currency');
  const [notice, setNotice] = useState('');
  return (
    <div className="rd-form">
      <p className="sp-muted">Keep a value or table connected to your Sheets.</p>
      <label>
        Expression
        <input defaultValue="=SUM('Quarterly budget'.October.D2:D6)" />
      </label>
      <p className="sp-muted">
        {state === 'private' ? 'Source unavailable' : 'Source: Quarterly budget / October'}
      </p>
      <Choice
        label="Format"
        value={format}
        onChange={setFormat}
        options={['General', 'Number', 'Currency', 'Percent', 'Date'].map((x) => ({
          value: x.toLowerCase(),
          label: x,
        }))}
      />
      <div className="rd-preview-value" role="status">
        {state === 'value' ? (
          '$258.50'
        ) : state === 'private' ? (
          'You need access to this formula’s sources.'
        ) : state === 'offline' ? (
          'Formula unavailable offline.'
        ) : state === 'invalid' ? (
          'Check this formula.'
        ) : state === 'loading' ? (
          'Loading result…'
        ) : state === 'empty' ? (
          'Empty value'
        ) : (
          <table>
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
        )}
      </div>
      <p className="sp-muted">
        {['private', 'offline', 'loading'].includes(state)
          ? 'Previous values stay hidden until access is confirmed.'
          : 'The document shows the result. Its expression stays editable.'}
      </p>
      <div className="sp-actions">
        <Button onClick={() => setNotice('Cancelled.')}>Cancel</Button>
        <Button
          primary
          disabled={['invalid', 'loading'].includes(state)}
          onClick={() => setNotice('Formula inserted in the preview.')}
        >
          Insert formula
        </Button>
      </div>
      <p role="status">{notice}</p>
    </div>
  );
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
}: {
  selected: string;
  setSelected: (value: string) => void;
}) {
  const older = selected.startsWith('October');
  const day = selected.match(/^October (\d+)/)?.[1] ?? '19';
  const checkpoints = older
    ? [
        `October ${day} · Final checkpoint`,
        `October ${day} · 11:45 · Before restore`,
        `October ${day} · 10:15 · Ready for the trip`,
      ]
    : [
        '12:30 · Latest',
        '11:45 · Before restore',
        '10:15 · Ready for the trip',
        '09:00 · Unnamed version',
      ];
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
            max="3"
            value={Math.max(
              0,
              [
                '09:00 · Unnamed version',
                '10:15 · Ready for the trip',
                '11:45 · Before restore',
                '12:30 · Latest',
              ].indexOf(selected),
            )}
            onChange={(e) =>
              setSelected(
                [
                  '09:00 · Unnamed version',
                  '10:15 · Ready for the trip',
                  '11:45 · Before restore',
                  '12:30 · Latest',
                ][Number(e.target.value)],
              )
            }
          />
        </label>
      )}
      {checkpoints.map((x) => (
        <Button key={x} onClick={() => setSelected(x)} aria-pressed={selected === x}>
          {x}
        </Button>
      ))}
      <p role="status">Selected: {selected}</p>
    </div>
  );
}
export function HistoryMockup({
  calendar = false,
  confirmation = false,
}: {
  calendar?: boolean;
  confirmation?: boolean;
}) {
  const [restore, setRestore] = useState(confirmation);
  const [selected, setSelected] = useState(
    calendar ? 'October 19 · Final checkpoint' : '10:15 · Ready for the trip',
  );
  const [notice, setNotice] = useState('');
  return (
    <Shell>
      <header className="rd-page-header">
        <div>
          <p className="rd-eyebrow">AUTUMN PLANS</p>
          <h1>Version history</h1>
        </div>
        <div className="sp-actions">
          <Button onClick={() => setNotice('Return to the live document without restoring.')}>
            Return to document
          </Button>
          <Button primary onClick={() => setRestore(true)}>
            Restore this version…
          </Button>
        </div>
      </header>
      <p className="rd-history-selection">
        Preview · {selected.startsWith('October') ? selected : `October 20, 2026 · ${selected}`} ·
        UTC
      </p>
      <div className="rd-history">
        <aside className="rd-inspector">
          <div className="rd-history-desktop">
            <HistoryContent selected={selected} setSelected={setSelected} />
          </div>
          <details className="rd-history-disclosure" open={calendar}>
            <summary>Choose version · {selected}</summary>
            <HistoryContent selected={selected} setSelected={setSelected} />
          </details>
        </aside>
        <DocumentSurface />
      </div>
      <p role="status">{notice}</p>
      <Modal
        title={`Restore ${selected.startsWith('October') ? selected : `October 20, 2026 · ${selected}`} for everyone?`}
        description="The current document will be kept as a Before restore checkpoint. Other open editors will need to reload."
        open={restore}
        onOpenChange={setRestore}
      >
        <div className="sp-actions">
          <Button onClick={() => setRestore(false)}>Cancel</Button>
          <Button
            primary
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
}: {
  section?: 'profile' | 'security' | 'connections' | 'device' | 'links';
}) {
  const [tab, setTab] = useState<string>(section);
  const theme = useSyncExternalStore(watchTheme, getPreference);
  const [notice, setNotice] = useState('');
  return (
    <Shell>
      <header className="rd-page-header">
        <div>
          <p className="rd-eyebrow">YOUR ACCOUNT</p>
          <h1>Your profile</h1>
        </div>
        <Button>Sign out</Button>
      </header>
      <div className="rd-profile">
        <nav aria-label="Profile sections">
          {[
            ['profile', 'Profile & appearance'],
            ['security', 'Passkeys'],
            ['connections', 'Connected assistants'],
            ['device', 'This device'],
            ['links', 'Guest links'],
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
          {tab === 'profile' ? (
            <>
              <h2>Make yourself at home</h2>
              <p className="sp-muted">Your name and icon help collaborators recognize you.</p>
              <div className="rd-profile-identity">
                <Avatar />
                <div>
                  <strong>Alex Baylee</strong>
                  <p className="sp-muted">Your everyday account</p>
                </div>
                <Button
                  onClick={() => setNotice('Choose a profile icon in the profile implementation.')}
                >
                  Change icon
                </Button>
              </div>
              <label>
                Display name
                <input defaultValue="Alex Baylee" />
              </label>
              <div className="sp-actions">
                <Button primary onClick={() => setNotice('Profile saved.')}>
                  Save profile
                </Button>
              </div>
              <section className="rd-section">
                <h2>Appearance</h2>
                <p className="sp-muted">A familiar workspace, in your preferred light.</p>
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
                <ActionMenu
                  label="Passkey actions"
                  actions={[{ label: 'Rename…' }, { label: 'Remove…', destructive: true }]}
                />
              </div>
              <Button primary>Add a passkey</Button>
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
              <h2>Connected assistants</h2>
              <p className="sp-muted">Manage applications you have allowed to access your files.</p>
              <div className="rd-setting-row">
                <span>
                  <strong>Notebook client</strong>
                  <small>client.example · Last used today</small>
                </span>
                <Button onClick={() => setNotice('Connection disconnected.')}>Disconnect</Button>
              </div>
              <details className="rd-section">
                <summary>Advanced: personal access tokens</summary>
                <p className="sp-muted">For applications you configure yourself.</p>
                <Button>Create token</Button>
              </details>
            </>
          ) : (
            <>
              <h2>This device</h2>
              <p className="sp-muted">Downloaded files are available without a connection.</p>
              <div className="rd-banner">
                This browser may clear offline files when space runs low.
              </div>
              <div className="rd-setting-row">
                <span>
                  Quarterly budget <small>Available offline · 84 KB</small>
                </span>
                <Button>Remove from device</Button>
              </div>
            </>
          )}
          <p className="rd-feedback" role="status">
            {notice}
          </p>
        </div>
      </div>
    </Shell>
  );
}
export function AdminMockup({
  state = 'ready',
  section = 'People',
}: {
  state?:
    'ready' | 'loading' | 'error' | 'invite-created' | 'health-warning' | 'disable' | 'passkeys';
  section?: string;
}) {
  const [tab, setTab] = useState(section);
  const [confirm, setConfirm] = useState(state === 'disable' ? 'Alex Kim' : '');
  const [passkeys, setPasskeys] = useState(state === 'passkeys' ? 'Alex Kim' : '');
  const [created, setCreated] = useState(state === 'invite-created');
  const [notice, setNotice] = useState('');
  return (
    <Shell operator compact>
      <header className="rd-page-header">
        <div>
          <p className="rd-eyebrow">SERVER OPERATOR</p>
          <h1>Administration</h1>
        </div>
        {tab === 'Invites' && (
          <Button primary={!created} onClick={() => setCreated(true)}>
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
          {state === 'loading' ? (
            <p role="status">Loading accounts…</p>
          ) : state === 'error' ? (
            <p role="alert">Could not load accounts. Try again.</p>
          ) : tab === 'People' ? (
            ['Operator (you)', 'Alex Baylee', 'Alex Kim'].map((person) => (
              <div className="rd-setting-row" key={person}>
                <span>
                  <strong>{person}</strong>
                  <small>
                    {person.startsWith('Operator')
                      ? 'Operator · Protected account'
                      : 'Member · Active · 1 passkey'}
                  </small>
                </span>
                <ActionMenu
                  label={`Actions for ${person}`}
                  actions={[
                    {
                      label: 'Manage passkeys',
                      onClick: () => setPasskeys(person),
                    },
                    {
                      label: 'Disable account…',
                      destructive: true,
                      disabled: person.startsWith('Operator'),
                      onClick: () => setConfirm(person),
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
              <div className="rd-setting-row">
                <span>
                  New account invite<small>Expires tomorrow</small>
                </span>
                <Button onClick={() => setNotice('Invite revoked.')}>Revoke</Button>
              </div>
            </>
          ) : tab === 'Connections' ? (
            <div className="rd-setting-row">
              <span>
                Notebook client<small>Alex Baylee · client.example · Last used today</small>
              </span>
              <span className="rd-badge">Active</span>
            </div>
          ) : (
            <>
              <div className="rd-setting-row">
                <span>
                  <strong>
                    {state === 'health-warning' ? 'Backup overdue' : '✓ Backups are current'}
                  </strong>
                  <small>
                    {state === 'health-warning'
                      ? 'Last successful backup: Oct 18 at 03:00 · Checked today at 12:30'
                      : 'Last successful backup: today at 03:00'}
                  </small>
                </span>
                <Button>Backup guide</Button>
              </div>
              <div className="rd-setting-row">
                <span>
                  <strong>✓ Server healthy</strong>
                  <small>Disk 18% · Memory 42% · Updated just now</small>
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
        title={`Passkeys for ${passkeys || 'account'}`}
        description="Account credentials only; documents remain private."
        open={Boolean(passkeys)}
        onOpenChange={(open) => {
          if (!open) setPasskeys('');
        }}
      >
        <div className="rd-setting-row">
          <span>
            MacBook<small>Last used today · Added October 18</small>
          </span>
          <Button
            disabled={passkeys.startsWith('Operator')}
            onClick={() =>
              setNotice('Passkey removal requires confirmation in the implementation.')
            }
          >
            Remove…
          </Button>
        </div>
        <p className="sp-muted">The Operator’s last passkey cannot be removed here.</p>
      </Modal>
      <Modal
        title={`Disable ${confirm || 'this account'}?`}
        description="Their sessions end now. Their documents and shares are kept."
        open={Boolean(confirm)}
        onOpenChange={(open) => {
          if (!open) setConfirm('');
        }}
      >
        <div className="sp-actions">
          <Button onClick={() => setConfirm('')}>Cancel</Button>
          <Button
            primary
            onClick={() => {
              setNotice(`${confirm} disabled in this preview.`);
              setConfirm('');
            }}
          >
            Disable account
          </Button>
        </div>
      </Modal>
    </Shell>
  );
}
export function EntryMockup({
  kind = 'sign-in',
  readOnly = false,
}: {
  readOnly?: boolean;
  kind?:
    | 'sign-in'
    | 'setup'
    | 'invite'
    | 'recovery'
    | 'revoked'
    | 'offline'
    | 'missing'
    | 'consent'
    | 'consent-expired';
}) {
  const [notice, setNotice] = useState('');
  const entries = {
    'sign-in': [
      'Welcome back.',
      'Your documents, right where you left them.',
      'Sign in with a passkey',
    ],
    setup: [
      'A place for your work.',
      'Create the Operator passkey to set up your private workspace.',
      'Create Operator passkey',
    ],
    invite: [
      'You’re invited.',
      'Create a passkey to join this private workspace.',
      'Create your passkey',
    ],
    recovery: ['Welcome back.', 'Add a new passkey to recover your account.', 'Add a new passkey'],
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
  return (
    <div className="sp-ui rd-entry">
      <div className="rd-entry-brand">
        <GemLogo />
        <strong>spinel</strong>
      </div>
      <section className="rd-entry-card">
        <h1>{title}</h1>
        <p className="sp-muted">{detail}</p>
        {kind === 'consent' && (
          <div className="rd-consent">
            <p>
              <strong>Notebook client</strong>
              <small>Client-supplied name · not verified</small>
            </p>
            <p>
              Callback: <strong>client.example</strong>
            </p>
            <p>
              {readOnly
                ? 'Can read files you can access. Cannot edit files.'
                : 'Can read files you can access and edit only files you have permission to edit.'}
            </p>
            <p>You can disconnect this application in Profile → Connections at any time.</p>
            <p>Signed in as Alex Baylee</p>
          </div>
        )}
        {action && (
          <Button
            primary
            onClick={() =>
              setNotice(
                kind === 'consent'
                  ? 'Connection allowed in this preview.'
                  : 'Continue in the application.',
              )
            }
          >
            {action}
          </Button>
        )}
        {kind === 'consent' && <Button>Cancel</Button>}
        <p className="rd-feedback" role="status">
          {notice}
        </p>
        {['sign-in', 'invite', 'recovery'].includes(kind) && (
          <small className="sp-muted">
            Use a passkey from your browser, password manager or phone.
          </small>
        )}
      </section>
      <footer>Private by invitation. Yours to make.</footer>
    </div>
  );
}
