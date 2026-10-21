/** SPN-047 review prototypes. No production routes, network calls or document writes. */
import { useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { GemLogo } from '../GemLogo.tsx';
import { EntityIcon } from '../EntityIcon.tsx';
import { getPreference, setPreference, watchTheme } from '../theme.ts';
import { ActionMenu, Button, Choice, DetailsPopover, Modal } from './Controls.tsx';
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
  | 'download';
const paths: Record<GlyphName, string> = {
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
function Avatar({ children = 'AB' }: { children?: ReactNode }) {
  return <span className="rd-avatar">{children}</span>;
}
function ThemeMenu() {
  const preference = useSyncExternalStore(watchTheme, getPreference);
  const [error, setError] = useState('');
  return (
    <>
      <ActionMenu
        label={`Appearance: ${preference}`}
        actions={['system', 'light', 'dark'].map((value) => ({
          label: `${value === preference ? '✓ ' : ''}${value === 'system' ? 'Follow system' : value === 'light' ? 'Vintage · Light' : 'Modern · Dark'}`,
          onClick: () =>
            setError(
              setPreference(value as 'system' | 'light' | 'dark')
                ? ''
                : 'Theme changed for this visit. Your preference could not be saved.',
            ),
        }))}
      >
        <Glyph name="sun" />
      </ActionMenu>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
function Sidebar({
  space = false,
  selected,
  onSelect,
  guest = false,
}: {
  space?: boolean;
  selected: string;
  onSelect: (view: string) => void;
  guest?: boolean;
}) {
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
        {
          title: 'FOLDERS',
          items: [
            ['Household', 'folder'],
            ['Work', 'folder'],
            ['Trips', 'folder'],
          ],
        },
      ];
  return (
    <nav className="rd-sidebar" aria-label={space ? 'Space contents' : 'Files'}>
      {groups.map((group) => (
        <section key={group.title}>
          <h2>{group.title}</h2>
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
      ))}
      {!guest && (
        <div className="rd-sidebar-bottom">
          <button className="rd-nav-item" onClick={() => onSelect('Trash')}>
            <Glyph name="trash" />
            {space ? 'Space trash' : 'Trash'}
          </button>
          <span className="rd-online">
            <Glyph name="check" /> Online
          </span>
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
  selected = 'My files',
  onSelect = () => {},
}: {
  children: ReactNode;
  sidebar?: boolean;
  space?: boolean;
  guest?: boolean;
  operator?: boolean;
  selected?: string;
  onSelect?: (view: string) => void;
}) {
  const [nav, setNav] = useState(false);
  return (
    <div
      className={`sp-ui rd-shell ${sidebar ? 'rd-with-sidebar' : ''} ${guest ? 'rd-guest' : ''}`}
    >
      {!guest && (
        <aside className="rd-rail" aria-label="Global navigation">
          <div className="rd-brand">
            <GemLogo />
          </div>
          <button
            className="rd-rail-button"
            aria-label={operator ? 'Administration' : 'My files'}
            onClick={() => onSelect('My files')}
          >
            <Glyph name={operator ? 'shield' : 'files'} />
          </button>
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
          <div className="rd-desktop-nav">
            <Sidebar space={space} selected={selected} onSelect={onSelect} guest={guest} />
          </div>
          <div className="rd-mobile-nav">
            <Button onClick={() => setNav(true)}>
              <Glyph name="menu" />
              {space ? 'Pages' : 'Browse files'}
            </Button>
          </div>
          <Modal
            title={space ? 'Space contents' : 'Browse files'}
            description="Choose where to go."
            open={nav}
            onOpenChange={setNav}
          >
            <Sidebar
              space={space}
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
  {
    name: 'Quarterly budget',
    kind: 'sheet' as const,
    detail: 'Shared · Can edit',
    date: '12 minutes ago',
    tags: 'household',
  },
  {
    name: 'Autumn plans',
    kind: 'space' as const,
    detail: 'Private',
    date: '1 hour ago',
    tags: 'travel',
  },
  {
    name: 'A few good recipes',
    kind: 'doc' as const,
    detail: 'Private',
    date: 'Yesterday',
    tags: '',
  },
  {
    name: 'Reading list',
    kind: 'sheet' as const,
    detail: 'Shared · View only',
    date: 'Yesterday',
    tags: '',
  },
  {
    name: 'Notes for next week',
    kind: 'doc' as const,
    detail: 'Private',
    date: 'Oct 18',
    tags: 'work',
  },
];
export function DashboardMockup({
  state = 'populated',
}: {
  state?: 'populated' | 'empty' | 'loading' | 'error' | 'search' | 'trash' | 'shared';
}) {
  const [view, setView] = useState(
    state === 'trash' ? 'Trash' : state === 'shared' ? 'Shared with me' : 'My files',
  );
  const [search, setSearch] = useState(state === 'search' ? 'budget' : '');
  const [notice, setNotice] = useState('');
  const [dialog, setDialog] = useState('');
  const [name, setName] = useState('');
  const [kind, setKind] = useState('all');
  const [removed, setRemoved] = useState<string[]>([]);
  if (view === 'Your profile') return <ProfileMockup />;
  const rows = files.filter(
    (file) =>
      file.name.toLowerCase().includes(search.toLowerCase()) &&
      (kind === 'all' || file.kind === kind) &&
      !removed.includes(file.name),
  );
  const empty = state === 'empty' || rows.length === 0;
  return (
    <Shell sidebar selected={view} onSelect={setView}>
      <header className="rd-page-header">
        <div>
          <p className="rd-eyebrow">YOUR WORKSPACE</p>
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
              placeholder="Search your files"
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
              { value: 'doc', label: 'Docs' },
              { value: 'sheet', label: 'Sheets' },
              { value: 'space', label: 'Spaces' },
            ]}
          />
        </div>
        <div className="rd-list-caption">
          <span>
            {view === 'Trash'
              ? 'Recover a file, or remove it permanently.'
              : search
                ? `Results for “${search}”`
                : 'A little room for everything you’re working on.'}
          </span>
          <span>{!empty && state === 'populated' ? `${rows.length} files` : ''}</span>
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
          <div className="rd-file-list" role="list" aria-label="Files">
            <div className="rd-column-head" aria-hidden="true">
              <span>Name</span>
              <span>Last edited</span>
              <span />
            </div>
            {rows.map((file) => (
              <div className="rd-file" role="listitem" key={file.name}>
                <button className="rd-file-open" onClick={() => setNotice(`Opening ${file.name}…`)}>
                  <EntityIcon kind={file.kind} size={32} />
                  <span>
                    <strong>{file.name}</strong>
                    <small>
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
                          { label: 'Open', onClick: () => setNotice(`Opening ${file.name}…`) },
                          { label: 'Pin', onClick: () => setNotice(`${file.name} pinned.`) },
                          { label: 'Tags…', onClick: () => setDialog('Tags') },
                          ...(file.detail.includes('View only') || view === 'Shared with me'
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
                          ...(!file.detail.includes('View only') && view !== 'Shared with me'
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
export function DocumentSurface({ sheet = false }: { sheet?: boolean }) {
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
          <span>＋</span>
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
        <aside className="rd-doc-note">
          <span className="rd-eyebrow">FROM OUR BUDGET</span>
          <strong>$258.50 left for the month</strong>
          <span className="sp-muted">A comfortable amount for a small adventure.</span>
        </aside>
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
}: {
  sheet?: boolean;
  guest?: boolean;
  viewOnly?: boolean;
  offline?: boolean;
  space?: boolean;
  formula?: boolean;
}) {
  const [share, setShare] = useState(false);
  const [selected, setSelected] = useState('Overview');
  const [panel, setPanel] = useState(formula ? 'Formula' : '');
  const [notice, setNotice] = useState('');
  const name = sheet ? 'Quarterly budget' : space ? selected : 'Autumn plans';
  return (
    <Shell sidebar={space} space={space} guest={guest} selected={selected} onSelect={setSelected}>
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
              onClick={() => setNotice('Back to My files')}
            >
              <Glyph name="back" />
            </Button>
          )}
          <EntityIcon kind={space ? 'space' : sheet ? 'sheet' : 'doc'} size={24} />
          <div>
            <span className="rd-breadcrumb">
              {space ? 'Autumn plans /' : guest ? 'Shared document' : 'Household /'}
            </span>
            <h1>{name}</h1>
          </div>
        </div>
        <div className="rd-status-slot">
          <DetailsPopover label={offline ? '↻ Waiting to sync' : '✓ Saved'}>
            <p>
              {offline
                ? 'Saved on this device. Your changes will sync when you reconnect.'
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
          {guest || viewOnly ? (
            <span className="rd-badge">{viewOnly ? 'View only' : 'Guest editor'}</span>
          ) : (
            <Button primary className="rd-desktop-share" onClick={() => setShare(true)}>
              Share
            </Button>
          )}
          {guest ? (
            <Button aria-label="Export as PDF" onClick={() => setNotice('Preparing PDF…')}>
              <Glyph name="download" />
            </Button>
          ) : (
            <ActionMenu
              label="Document actions"
              actions={[
                ...(!viewOnly ? [{ label: 'Share…', onClick: () => setShare(true) }] : []),
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
          <DocumentSurface sheet={sheet || selected === 'Budget'} />
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
              <HistoryContent />
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
function SharingContent({ delegated = false }: { delegated?: boolean }) {
  const [role, setRole] = useState('edit');
  const [link, setLink] = useState(false);
  const [notice, setNotice] = useState('');
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
            setRole(v);
            setNotice('Access updated. Inherited folder access still applies.');
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
          {link
            ? 'Guests can view. Copy this address now.'
            : 'Off. Only people with access can open this file.'}
        </p>
        {link && (
          <label>
            Guest address
            <input readOnly value="https://spinel.example/share/preview#sample" />
          </label>
        )}
        <div className="sp-actions">
          <Button
            onClick={() => {
              setLink(!link);
              setNotice(link ? 'Guest link turned off.' : 'Guest link created for this preview.');
            }}
          >
            {link ? 'Turn off link' : 'Create view-only link'}
          </Button>
        </div>
        <p className="sp-muted">Collaborator names are hidden while link sharing is on.</p>
      </section>
      <p role="status" className="rd-feedback">
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
export function SharingMockup({ delegated = false }: { delegated?: boolean }) {
  return (
    <div className="sp-ui rd-dialog-stage">
      <section className="rd-dialog-example" aria-label="Sharing design">
        <h1>Share Autumn plans</h1>
        <p className="sp-muted">
          {delegated
            ? 'File admins manage this file. They have no server access.'
            : 'Choose who can open this file.'}
        </p>
        <SharingContent delegated={delegated} />
      </section>
    </div>
  );
}
function FormulaForm() {
  const [source, setSource] = useState('budget');
  const [notice, setNotice] = useState('');
  return (
    <div className="rd-form">
      <p className="sp-muted">Keep a number or table connected to your Sheet.</p>
      <Choice
        label="Source sheet"
        value={source}
        onChange={setSource}
        options={[
          { value: 'budget', label: 'Quarterly budget' },
          { value: 'unavailable', label: 'Source unavailable' },
        ]}
      />
      <label>
        Formula
        <input defaultValue="=SUM(D2:D6)" />
      </label>
      <div className="rd-preview-value">
        {source === 'unavailable' ? 'Source unavailable' : '$258.50'}
      </div>
      <p className="sp-muted">
        {source === 'unavailable'
          ? 'You need access to every source. Previous values stay hidden.'
          : 'This value updates when the source changes.'}
      </p>
      <Button
        primary
        disabled={source === 'unavailable'}
        onClick={() => setNotice('Formula inserted in the preview.')}
      >
        Insert formula
      </Button>
      <p role="status">{notice}</p>
    </div>
  );
}
export function FormulaMockup() {
  return (
    <div className="sp-ui rd-dialog-stage">
      <section className="rd-dialog-example">
        <h1>Insert formula</h1>
        <FormulaForm />
      </section>
    </div>
  );
}
function HistoryContent() {
  return (
    <div className="rd-form">
      <p className="sp-muted">Previewing leaves your live document unchanged.</p>
      <label>
        October 20 · UTC
        <input type="range" min="0" max="4" defaultValue="3" />
      </label>
      <h3>Today</h3>
      {[
        '12:30 · Latest',
        '11:45 · Before restore',
        '10:15 · Ready for the trip',
        '09:00 · Unnamed version',
      ].map((x) => (
        <Button key={x}>{x}</Button>
      ))}
      <Button>Older days</Button>
    </div>
  );
}
export function HistoryMockup() {
  return (
    <Shell>
      <header className="rd-page-header">
        <div>
          <p className="rd-eyebrow">AUTUMN PLANS</p>
          <h1>Version history</h1>
        </div>
        <Button primary>Restore this version…</Button>
      </header>
      <div className="rd-history">
        <aside className="rd-inspector">
          <HistoryContent />
        </aside>
        <DocumentSurface />
      </div>
    </Shell>
  );
}
export function ProfileMockup({
  section = 'profile',
}: {
  section?: 'profile' | 'connections' | 'device';
}) {
  const [tab, setTab] = useState<string>(section);
  const [theme, setTheme] = useState('system');
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
                <Choice
                  label="Theme"
                  value={theme}
                  onChange={(v) => {
                    setTheme(v);
                    setPreference(v as 'system' | 'light' | 'dark');
                  }}
                  options={[
                    { value: 'system', label: 'Follow system' },
                    { value: 'light', label: 'Vintage · Light' },
                    { value: 'dark', label: 'Modern · Dark' },
                  ]}
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
export function AdminMockup({ state = 'ready' }: { state?: 'ready' | 'loading' | 'error' }) {
  const [tab, setTab] = useState('People');
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState('');
  return (
    <Shell operator>
      <header className="rd-page-header">
        <div>
          <p className="rd-eyebrow">SERVER OPERATOR</p>
          <h1>Administration</h1>
        </div>
        <Button
          primary
          onClick={() => setNotice('Invite ready. Copy its address before leaving this page.')}
        >
          Create invite
        </Button>
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
            ['Alex Baylee', 'Alex Kim'].map((person) => (
              <div className="rd-setting-row" key={person}>
                <span>
                  <strong>{person}</strong>
                  <small>Member · Active · 1 passkey</small>
                </span>
                <ActionMenu
                  label={`Actions for ${person}`}
                  actions={[
                    {
                      label: 'Manage passkeys',
                      onClick: () => setNotice('MacBook · Last used today'),
                    },
                    {
                      label: 'Disable account…',
                      destructive: true,
                      onClick: () => setConfirm(true),
                    },
                  ]}
                />
              </div>
            ))
          ) : tab === 'Invites' ? (
            <div className="rd-setting-row">
              <span>
                New account invite<small>Expires tomorrow</small>
              </span>
              <Button onClick={() => setNotice('Invite revoked.')}>Revoke</Button>
            </div>
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
                  <strong>✓ Backups are current</strong>
                  <small>Last successful backup: today at 03:00</small>
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
        title="Disable this account?"
        description="Their sessions end now. Their documents and shares are kept."
        open={confirm}
        onOpenChange={setConfirm}
      >
        <div className="sp-actions">
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button
            primary
            onClick={() => {
              setNotice('Account disabled.');
              setConfirm(false);
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
}: {
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
            <p>Can read and edit files you can access.</p>
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
