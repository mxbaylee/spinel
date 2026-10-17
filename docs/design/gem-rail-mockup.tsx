// The gem rail mockup's app, loaded by gem-rail-mockup.html. Babel compiles it in
// the browser and `npm run typecheck` checks it. React and Lucide are the page's
// UMD globals. SPN-027 deletes docs/design/ once the real theme and screens land.
/// <reference types="react" />

declare const ReactDOM: typeof import('react-dom/client');
type LucideNode = [tag: string, attrs: Record<string, string | number>][];
declare global {
  interface Window {
    lucide?: { icons: Record<string, LucideNode> };
  }
}

const { useState, useEffect, useRef, useMemo } = React;

interface Cell { v: string; b?: boolean; i?: boolean; f?: string }
type Cells = Record<string, Cell>;
interface Tab { name: string; cells: Cells }
interface DocBase { id: number; name: string; folder: string; edited: string }
type SheetDoc = DocBase & { type: 'sheet'; tabs: Tab[] };
type Doc = SheetDoc | (DocBase & { type: 'doc' });
interface User { id: number; name: string; email: string; color: string; icon: string; keys: string[]; active: boolean }
interface Invite { id: number; email: string; days: number }
type Say = (msg: string) => void;
type Theme = 'light' | 'dark';
type Screen = 'home' | 'sheet' | 'profile' | 'users';
type Pos = [row: number, col: number];

// ---------- Data ----------
const COLS = 8, ROWS = 16, LETTERS = 'ABCDEFGH';
const PRESETS = ['primary', 'secondary', 'success', 'warning', 'error', 'info', 'neutral', 'highlight'];
const PRESET_NAMES = ['Primary', 'Secondary', 'Success', 'Warning', 'Error', 'Info', 'Neutral', 'Highlight'];
const ref = (r: number, c: number) => LETTERS[c] + (r + 1);
const key = (r: number, c: number) => r + ',' + c;

function budgetCells(): Cells {
  const rows = [
    ['Month', 'Rent', 'Food', 'Fun', 'Total'],
    ['Jan', '1800', '420', '150', '=SUM(B2:D2)'],
    ['Feb', '1800', '385', '90', '=SUM(B3:D3)'],
    ['Mar', '1800', '460', '210', '=SUM(B4:D4)'],
    ['Apr', '1800', '410', '120', '=SUM(B5:D5)'],
    ['Total', '=SUM(B2:B5)', '=SUM(C2:C5)', '=SUM(D2:D5)', '=SUM(E2:E5)'],
  ];
  const cells: Cells = {};
  rows.forEach((row, r) => row.forEach((v, c) => { cells[key(r, c)] = { v }; }));
  for (let c = 0; c < 5; c++) {
    Object.assign(cells[key(0, c)], { b: true, f: 'primary-soft' });
    Object.assign(cells[key(5, c)], { b: true, f: 'neutral-soft' });
  }
  cells[key(3, 2)].f = 'error-soft';
  cells[key(2, 3)].f = 'success-soft';
  cells[key(5, 4)].f = 'primary-strong';
  cells[key(7, 0)] = { v: 'Food over 450 is flagged', i: true };
  return cells;
}
const blankTab = (name: string): Tab => ({ name, cells: {} });
const initialDocs = (): Doc[] => [
  { id: 1, name: '2027 budget', type: 'sheet', folder: 'Budgets', edited: '2 hours ago', tabs: [{ name: 'Budget', cells: budgetCells() }, blankTab('Savings')] },
  { id: 2, name: 'Packing list', type: 'doc', folder: 'Trips', edited: 'Yesterday' },
  { id: 3, name: 'Wedding guests', type: 'sheet', folder: 'Shared with you', edited: 'Monday', tabs: [blankTab('Guests')] },
  { id: 4, name: 'Recipe notes', type: 'doc', folder: 'Your docs', edited: 'Last week' },
  { id: 5, name: 'House fund', type: 'sheet', folder: 'Budgets', edited: 'Sep 3', tabs: [blankTab('Fund')] },
];
const ME = 1, PEER = 2; // you, and the other person in the open sheet
const initialUsers: User[] = [
  { id: 1, name: 'Baylee', email: 'baylee@example.com', color: 'info-strong', icon: 'sparkles', keys: ['1Password', 'iCloud Keychain'], active: true },
  { id: 2, name: 'Sam Rivera', email: 'sam@example.com', color: 'secondary-strong', icon: 'bird', keys: ['Proton Pass'], active: true },
  { id: 3, name: 'Alex Kim', email: 'alex@example.com', color: 'success-soft', icon: 'sprout', keys: [], active: false },
];
const fmt = (n: number | string) => (typeof n === 'number' ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n);

// ---------- Formulas: numbers, cell refs, + - * / ( ) and SUM(A1:B2) ----------
function evaluate(cells: Cells, r: number, c: number, seen = new Set<string>()): number | string {
  const raw = cells[key(r, c)]?.v ?? '';
  if (raw[0] !== '=') return raw !== '' && !isNaN(Number(raw)) ? Number(raw) : raw;
  const k = key(r, c);
  if (seen.has(k)) return '#CYCLE';
  seen.add(k);
  try { return evalExpr(cells, raw.slice(1).toUpperCase(), seen); }
  catch (e) { return typeof e === 'string' ? e : '#ERR'; }
  finally { seen.delete(k); }
}

function evalExpr(cells: Cells, src: string, seen: Set<string>): number {
  const toks: string[] = src.match(/[A-H]\d+:[A-H]\d+|[A-H]\d+|\d+(?:\.\d+)?|SUM|[-+*/()]/g) || [];
  if (toks.join('') !== src.replace(/\s+/g, '')) throw 1;
  let i = 0;
  const at = (t: string): Pos => [Number(t.slice(1)) - 1, LETTERS.indexOf(t[0])];
  const val = (t: string): number => {
    const x = evaluate(cells, ...at(t), seen);
    if (typeof x === 'string' && x[0] === '#') throw x;
    return typeof x === 'number' ? x : 0;
  };
  const prim = (): number => {
    const t = toks[i++];
    if (t === 'SUM') {
      if (toks[i++] !== '(') throw 1;
      const [a, b = a] = (toks[i++] || '').split(':');
      if (toks[i++] !== ')' || !/^[A-H]\d+$/.test(a)) throw 1;
      const [r1, c1] = at(a), [r2, c2] = at(b);
      let sum = 0;
      for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++)
        for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) sum += val(ref(r, c));
      return sum;
    }
    if (t === '(') { const e = add(); if (toks[i++] !== ')') throw 1; return e; }
    if (t === '-') return -prim();
    if (/^[A-H]\d+$/.test(t ?? '')) return val(t);
    if (t != null && !isNaN(Number(t))) return Number(t);
    throw 1;
  };
  const mul = (): number => { let a = prim(); while (toks[i] === '*' || toks[i] === '/') { const o = toks[i++], b = prim(); a = o === '*' ? a * b : a / b; } return a; };
  const add = (): number => { let a = mul(); while (toks[i] === '+' || toks[i] === '-') { const o = toks[i++], b = mul(); a = o === '+' ? a + b : a - b; } return a; };
  const out = add();
  if (i < toks.length) throw 1;
  return out;
}

// ---------- Icons (inline stroke SVG) ----------
const ICONS = {
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  sheet: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></>,
  doc: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></>,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  fill: <><path d="M5 11l7-7 7 7-7 7z" /><path d="M19 15s2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z" /></>,
};
type IconName = keyof typeof ICONS;
function Icon({ name, className = '', style, label }: { name: IconName; className?: string; style?: React.CSSProperties; label?: string }) {
  return (
    <svg className={'i ' + className} viewBox="0 0 24 24" style={style} aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      {ICONS[name]}
    </svg>
  );
}

// ---------- Logo: a faceted heart, drawn point-down; theme.css flips it in dark ----------
const HEART = 'M50 27C44 13 31 6 20 9 8 12 2 24 4 37 7 56 29 76 50 94 71 76 93 56 96 37 98 24 92 12 80 9 69 6 56 13 50 27Z';
const GEM_POINTS: Record<string, Pos> = {
  A: [23, 33], B: [77, 33], D: [50, 80], K1: [50, 22], K2: [34, 12], K3: [66, 12], K4: [7, 30], K5: [93, 30],
  K6: [15, 60], K7: [85, 60], K8: [38, 85], K9: [62, 85], P: [50, 94],
  TL: [20, -10], T: [50, -10], TR: [80, -10], L1: [-10, 20], L2: [-10, 62], R1: [110, 20], R2: [110, 62], BOT: [50, 110],
};
// Each facet: its corners and a tone from 1 (darkest) to 6 (lightest). Outer facets overshoot and are clipped to HEART.
const GEM_FACETS = ([
  ['TL T K1 K2', 3], ['T TR K3 K1', 2], ['TL K2 K4 L1', 3], ['TR R1 K5 K3', 2],
  ['L1 K4 K6 L2', 4], ['L2 K6 K8 P BOT', 3], ['R1 R2 K7 K5', 2], ['R2 BOT P K9 K7', 1],
  ['A K2 K1', 4], ['K1 K3 B', 3], ['A K1 B', 2], ['K4 K2 A', 5], ['B K3 K5', 2],
  ['K4 A K6', 6], ['K6 A D', 5], ['K6 D K8', 3], ['K5 K7 B', 3], ['K7 D B', 1], ['K7 K9 D', 2],
  ['K8 D P', 2], ['D K9 P', 1], ['A B D', 4],
] as [string, number][]).map(([corners, tone]) => ({ d: 'M' + corners.split(' ').map((n) => GEM_POINTS[n].join(' ')).join('L') + 'Z', tone }));

function GemLogo({ size = 36 }: { size?: number }) {
  const clip = React.useId();
  return (
    <svg className="gem" width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Spinel">
      <defs><clipPath id={clip}><path d={HEART} /></clipPath></defs>
      <g clipPath={`url(#${clip})`} strokeWidth="0.6" strokeLinejoin="round">
        {GEM_FACETS.map((f, n) => <path key={n} d={f.d} fill={`var(--gem-${f.tone})`} stroke={`var(--gem-${f.tone})`} />)}
      </g>
      <path d={HEART} fill="none" stroke="var(--gem-edge)" strokeWidth="3.2" strokeLinejoin="round" />
    </svg>
  );
}

// ---------- People: a profile colour (any of the 16 fill presets) and a Lucide icon ----------
// Same order as the cell palette: strong on the first row, soft below.
const AVATAR_COLOURS = ['strong', 'soft'].flatMap((shade) => PRESETS.map((role, i) => ({ id: `${role}-${shade}`, name: `${PRESET_NAMES[i]}, ${shade}` })));

const pascal = (name: string) => name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join('');
function LucideIcon({ name, size = 18 }: { name: string; size?: number }) {
  const node: LucideNode = window.lucide?.icons[pascal(name)] || window.lucide?.icons.UserRound || [];
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true" style={{ width: size, height: size }}>
      {node.map(([tag, attrs], n) => React.createElement(tag, { key: n, ...attrs }))}
    </svg>
  );
}
function Avatar({ user, size = 36, label, decorative }: { user: User; size?: number; label?: string; decorative?: boolean }) {
  const a11y: React.HTMLAttributes<HTMLSpanElement> = decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label ?? user.name, title: label ?? user.name };
  return (
    <span className={`av fill-${user.color}`} style={{ width: size, height: size }} {...a11y}>
      <LucideIcon name={user.icon} size={Math.round(size * 0.55)} />
    </span>
  );
}

// ---------- Icon search: a port of docs/reference/icons/person-icon-search.ts ----------
// It ranks names over Lucide's tags. The reference also folds in local synonyms
// ("lotus", "doctor"); this mockup skips those.
interface CatalogIcon { name: string; tags: string[]; categories: string[] }
interface PickerIcon extends CatalogIcon { label: string; words: [word: string, priority: number][] }
const FALLBACK_ICONS: CatalogIcon[] = ['user-round', 'sparkles', 'bird', 'sprout', 'cat', 'dog', 'heart', 'star', 'moon', 'sun', 'flower', 'flower-2', 'crown', 'cookie', 'coffee', 'music', 'rocket', 'ghost', 'gem', 'leaf', 'rabbit', 'fish', 'turtle', 'snail']
  .map((name) => ({ name, tags: [], categories: [] }));
const words = (text: string) => text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const labelFor = (name: string) => name.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
function buildCatalog(icons: CatalogIcon[]): PickerIcon[] {
  // The reference's ICON_SEARCH_ALIASES: old names for another icon, shown once under the new name.
  const aliases = new Set(['alarm-check', 'alarm-minus', 'alarm-plus']);
  return icons.filter((icon) => !aliases.has(icon.name) && window.lucide?.icons[pascal(icon.name)]).map((icon) => {
    const found = new Map<string, number>();
    for (const [text, priority] of [[icon.name, 40], [[...icon.tags, ...icon.categories].join(' '), 20]] as [string, number][])
      for (const w of words(text)) found.set(w, Math.max(found.get(w) ?? 0, priority));
    return { ...icon, label: labelFor(icon.name), words: [...found] };
  });
}
function distance(a: string, b: string): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + Number(a[i - 1] !== b[j - 1]));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
    }
  return rows[a.length][b.length];
}
function searchIcons(catalog: PickerIcon[], query: string, category: string): PickerIcon[] {
  const tokens = words(query).slice(0, 8);
  const pool = catalog.filter((icon) => category === 'All' || icon.categories.includes(category));
  if (query.trim() && !tokens.length) return [];
  if (!tokens.length) return pool;
  return pool.map((icon) => {
    let score = 0;
    for (const t of tokens) {
      let best = 0;
      for (const [w, pr] of icon.words) {
        if (w === t) best = Math.max(best, 100 + pr);
        else if (w.startsWith(t)) best = Math.max(best, 70 + pr);
        else if (t.length >= 3 && w.includes(t)) best = Math.max(best, 40 + pr);
        else if (t.length >= 4 && Math.abs(t.length - w.length) <= (t.length >= 8 ? 2 : 1)) {
          const d = distance(t, w);
          if (d <= (t.length >= 8 ? 2 : 1)) best = Math.max(best, 25 - d * 5 + pr);
        }
      }
      if (!best) return { icon, score: 0 };
      score += best;
    }
    if (tokens.join('-') === icon.name) score += 200;
    return { icon, score };
  }).filter((m) => m.score > 0).sort((a, b) => b.score - a.score || a.icon.name.localeCompare(b.icon.name)).map((m) => m.icon);
}
function useIconCatalog(): [PickerIcon[], boolean] {
  const [catalog, setCatalog] = useState(() => buildCatalog(FALLBACK_ICONS));
  const [full, setFull] = useState(false);
  useEffect(() => {
    fetch('../reference/icons/person-icon-catalog.json')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: { icons: CatalogIcon[] }) => { setCatalog(buildCatalog(data.icons)); setFull(true); })
      .catch(() => {});
  }, []);
  return [catalog, full];
}

function IconPicker({ value, onChange }: { value: string; onChange: (name: string) => void }) {
  const [catalog, full] = useIconCatalog();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [limit, setLimit] = useState(60);
  const grid = useRef<HTMLDivElement>(null);
  const categories = useMemo(() => [...new Set(catalog.flatMap((i) => i.categories))].sort(), [catalog]);
  const matches = useMemo(() => searchIcons(catalog, query, category), [catalog, query, category]);
  const shown = matches.slice(0, limit);
  useEffect(() => { setLimit(60); if (grid.current) grid.current.scrollTop = 0; }, [query, category]);
  const move = (e: React.KeyboardEvent, n: number) => {
    if (!grid.current) return;
    const buttons = [...grid.current.querySelectorAll('button')];
    const cols = getComputedStyle(grid.current).gridTemplateColumns.split(' ').length;
    const step = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols } as Record<string, number>)[e.key];
    if (step === undefined && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, n + (step ?? 0)));
    buttons[next]?.focus();
  };
  return (
    <div className="field">
      <span className="label">Icon</span>
      <div className="row" style={{ gap: 8 }}>
        <label className="inp row search" style={{ gap: 8, flex: '1 1 220px' }}>
          <Icon name="search" className="mu" />
          <input aria-label="Search icons" placeholder="Search icons, like bird or flowre" value={query} onChange={(e) => setQuery(e.target.value)}
            style={{ border: 0, background: 'transparent', outline: 'none', minHeight: 38, flex: 1, minWidth: 0 }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); grid.current?.querySelector('button')?.focus(); }
              if (e.key === 'Enter' && matches.length === 1) { e.preventDefault(); onChange(matches[0].name); }
            }} />
        </label>
        {categories.length > 0 && (
          <select className="inp" aria-label="Icon category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option>All</option>
            {categories.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
          </select>
        )}
      </div>
      <p className="mu small" role="status" style={{ margin: 0 }}>
        {matches.length} {matches.length === 1 ? 'icon' : 'icons'}{full ? '' : ' (short list: serve docs/ to load all of Lucide)'}
      </p>
      <div className="iconpick-grid" ref={grid} role="group" aria-label="Icon results">
        {shown.map((icon, n) => (
          <button key={icon.name} type="button" aria-pressed={icon.name === value} aria-label={icon.label} title={[icon.label, ...icon.tags].join(' · ')}
            onClick={() => onChange(icon.name)} onKeyDown={(e) => move(e, n)}>
            <LucideIcon name={icon.name} size={24} /><span>{icon.label}</span>
          </button>
        ))}
      </div>
      {matches.length > limit && <button type="button" className="link" onClick={() => setLimit((l) => l + 60)}>Show more icons ({limit} of {matches.length})</button>}
      {!matches.length && <p className="mu" style={{ margin: 0 }}>No icons match. Try another name or description.</p>}
    </div>
  );
}

// ---------- Your profile ----------
function Profile({ me, updateMe, say, switchToAdmin }: { me: User; updateMe: (change: Partial<User>) => void; say: Say; switchToAdmin: () => void }) {
  const [name, setName] = useState(me.name);
  const error = name.trim() ? '' : 'Enter a name people will recognise.';
  return (
    <main className="main" style={{ maxWidth: 820 }}>
      <div>
        <h1>Your profile</h1>
        <p className="mu" style={{ margin: '4px 0 0' }}>This is how you appear to people you share with: in their sheets, beside your cursor and in invites.</p>
      </div>
      <div className="card row" style={{ flexDirection: 'row', gap: 14 }}>
        <Avatar user={me} size={56} />
        <div><strong style={{ fontSize: 17 }}>{me.name}</strong><div className="mu small">{me.email}</div></div>
      </div>
      <label className="field">
        <span className="label">Display name</span>
        <input className="inp" value={name} aria-invalid={!!error} aria-describedby="name-error"
          onChange={(e) => { setName(e.target.value); if (e.target.value.trim()) updateMe({ name: e.target.value.trim() }); }} />
        {error && <span className="error" id="name-error">{error}</span>}
      </label>
      <div className="field" role="group" aria-labelledby="colour-label">
        <span className="label" id="colour-label">Profile colour</span>
        <div className="colours">
          {AVATAR_COLOURS.map(({ id, name }) => (
            <button key={id} type="button" className={`colour fill-${id}`} aria-pressed={me.color === id} aria-label={name} title={name} onClick={() => updateMe({ color: id })}>
              {me.color === id && <LucideIcon name="check" size={20} />}
            </button>
          ))}
        </div>
      </div>
      <IconPicker value={me.icon} onChange={(icon) => updateMe({ icon })} />
      <section className="field" aria-label="Passkeys">
        <span className="label">Passkeys</span>
        <div className="row" style={{ gap: 6 }}>
          {me.keys.map((k) => <span key={k} className="tag"><Icon name="key" style={{ width: 14, height: 14 }} />{k}</span>)}
          <button className="btn" onClick={() => say('Adding a passkey comes in SPN-002')}>Add a passkey</button>
        </div>
      </section>
      <div className="row mu small" style={{ borderTop: '1px solid var(--sp-border)', paddingTop: 14 }}>
        Mockup only:
        <button className="btn" onClick={switchToAdmin}>Switch to the admin account</button>
      </div>
    </main>
  );
}

// ---------- App shell ----------
function systemTheme(): Theme {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
}

function useToast(): [string, Say] {
  const [toast, setToast] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const say = (msg: string) => { clearTimeout(timer.current); setToast(msg); timer.current = setTimeout(() => setToast(''), 2400); };
  return [toast, say];
}

function App() {
  const [theme, setTheme] = useState<Theme>(systemTheme);
  const [account, setAccount] = useState<'owner' | 'admin'>('owner');
  const [screen, setScreen] = useState<Screen>('home');
  const [docs, setDocs] = useState(initialDocs);
  const [docId, setDocId] = useState(1);
  const [users, setUsers] = useState(initialUsers);
  const [toast, say] = useToast();
  // ME and PEER are in initialUsers, and nothing removes users.
  const me = users.find((u) => u.id === ME)!, peer = users.find((u) => u.id === PEER)!;
  const updateMe = (change: Partial<User>) => setUsers((all) => all.map((u) => (u.id === ME ? { ...u, ...change } : u)));

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const isAdmin = account === 'admin';
  const current = isAdmin ? 'users' : screen;
  const doc = docs.find((d) => d.id === docId);
  const updateDoc = (id: number, change: (d: SheetDoc) => Partial<SheetDoc>) =>
    setDocs((all) => all.map((d) => (d.id === id && d.type === 'sheet' ? { ...d, ...change(d), edited: 'Just now' } : d)));
  const firstSheet = doc?.type === 'sheet' ? doc : docs.find((d) => d.type === 'sheet');

  const open = (d: Doc) => {
    if (d.type === 'doc') return say('The doc editor isn’t part of this mockup yet');
    setDocId(d.id);
    setScreen('sheet');
  };
  const switchAccount = () => {
    setAccount(isAdmin ? 'owner' : 'admin');
    setScreen('home');
    say(isAdmin ? 'Signed in as ' + me.name : 'Signed in as the admin account');
  };

  return (
    <div className="app">
      <nav className="rail" aria-label="Spinel">
        <button className="rb logo" aria-label={isAdmin ? 'Spinel, go to People' : 'Spinel, go to your docs'} data-tip={isAdmin ? 'People' : 'Your docs'} onClick={() => setScreen('home')}>
          <span className="wiggle"><GemLogo /></span>
        </button>
        {isAdmin ? (
          <button className="rb on" aria-label="People" data-tip="People"><Icon name="users" /></button>
        ) : (
          <>
            <button className={'rb ' + (current === 'home' ? 'on' : '')} aria-label="Your docs" data-tip="Your docs" onClick={() => setScreen('home')}><Icon name="folder" /></button>
            <button className={'rb ' + (current === 'sheet' ? 'on' : '')} aria-label="Open spreadsheet" data-tip="Open spreadsheet" onClick={() => firstSheet && open(firstSheet)}><Icon name="sheet" /></button>
          </>
        )}
        <div className="grow" />
        <button className="rb" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Switch to light, younger Spinel' : 'Switch to dark, older Spinel'} data-tip={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        {isAdmin ? (
          <button className="rb" onClick={switchAccount} aria-label={'Admin account. Switch to ' + me.name} data-tip={'Switch to ' + me.name}>
            <span className="av" style={{ width: 32, height: 32, background: 'var(--sp-rail-ink)', color: 'var(--sp-rail)', fontSize: 13 }}>A</span>
          </button>
        ) : (
          <button className={'rb ' + (current === 'profile' ? 'on' : '')} onClick={() => setScreen('profile')} aria-label={'Your profile, ' + me.name} data-tip="Your profile">
            <Avatar user={me} size={32} decorative />
          </button>
        )}
      </nav>
      {current === 'home' && <Home me={me} docs={docs} setDocs={setDocs} open={open} say={say} />}
      {current === 'users' && <Users users={users} setUsers={setUsers} say={say} />}
      {current === 'profile' && <Profile me={me} updateMe={updateMe} say={say} switchToAdmin={switchAccount} />}
      {current === 'sheet' && doc?.type === 'sheet' && <Sheet key={doc.id} doc={doc} peer={peer} updateDoc={(change) => updateDoc(doc.id, change)} back={() => setScreen('home')} say={say} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

// ---------- Docs home ----------
const FOLDERS = ['All', 'Your docs', 'Budgets', 'Trips', 'Shared with you'];

interface HomeProps {
  me: User;
  docs: Doc[];
  setDocs: React.Dispatch<React.SetStateAction<Doc[]>>;
  open: (d: Doc) => void;
  say: Say;
}

function Home({ me, docs, setDocs, open, say }: HomeProps) {
  const [folder, setFolder] = useState('All');
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const shown = docs.filter((d) => (folder === 'All' || d.folder === folder) && (!q || d.name.toLowerCase().includes(q)));
  const target = folder === 'All' || folder === 'Shared with you' ? 'Your docs' : folder;

  const create = (type: Doc['type']) => {
    const base = { id: Date.now(), folder: target, edited: 'Just now' };
    const d: Doc = type === 'sheet' ? { ...base, type, name: 'Untitled sheet', tabs: [blankTab('Sheet 1')] } : { ...base, type, name: 'Untitled doc' };
    setDocs((all) => [d, ...all]);
    if (type === 'sheet') open(d); else say('Doc created. The doc editor isn’t part of this mockup yet');
  };

  return (
    <main className="main">
      <div className="row">
        <h1 style={{ flex: '1 1 240px' }}>Good morning, {me.name}</h1>
        <label className="inp row search" style={{ gap: 8 }}>
          <Icon name="search" className="mu" />
          <input aria-label="Search your docs" placeholder="Search your docs" value={search} onChange={(e) => setSearch(e.target.value)} style={{ border: 0, background: 'transparent', outline: 'none', minHeight: 38, width: 180, flex: 1, minWidth: 0 }} />
        </label>
      </div>
      <div className="row" style={{ gap: 14 }}>
        <button className="tile" style={{ background: 'var(--sp-tint-1)' }} onClick={() => create('sheet')}>
          <Icon name="sheet" style={{ width: 26, height: 26, color: 'var(--sp-accent)' }} /><strong>New sheet</strong><span className="mu">Numbers, lists and budgets</span>
        </button>
        <button className="tile" style={{ background: 'var(--sp-tint-2)', borderTopColor: 'var(--sp-accent-2)' }} onClick={() => create('doc')}>
          <Icon name="doc" style={{ width: 26, height: 26, color: 'var(--sp-accent-2)' }} /><strong>New doc</strong><span className="mu">Notes, letters and plans</span>
        </button>
      </div>
      <div className="row" style={{ gap: 8 }} role="group" aria-label="Folders">
        {FOLDERS.map((f) => <button key={f} className={'chip ' + (folder === f ? 'on' : '')} aria-pressed={folder === f} onClick={() => setFolder(f)}>{f}</button>)}
      </div>
      <section aria-label="Recent">
        <div className="label" style={{ marginBottom: 4 }}>Recent</div>
        {shown.map((d) => (
          <button key={d.id} className="drow" onClick={() => open(d)}>
            <Icon name={d.type} style={{ color: d.type === 'sheet' ? 'var(--sp-accent)' : 'var(--sp-accent-2)' }} />
            <span className="name">{d.name}</span>
            <span className="mu folder" style={{ minWidth: 110 }}>{d.folder}</span>
            <span className="mu" style={{ minWidth: 90, textAlign: 'right' }}>{d.edited}</span>
          </button>
        ))}
        {shown.length === 0 && <p className="mu">Nothing matches that search. Try another word or folder.</p>}
      </section>
    </main>
  );
}

// ---------- User management (admin account) ----------
function Users({ users, setUsers, say }: { users: User[]; setUsers: React.Dispatch<React.SetStateAction<User[]>>; say: Say }) {
  const [invites, setInvites] = useState<Invite[]>([{ id: 1, email: 'jo@example.com', days: 2 }]);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return setError('Enter an email address, like jo@example.com.');
    if (users.some((u) => u.email === em) || invites.some((v) => v.email === em)) return setError('That person already has an account or an invite.');
    setInvites((all) => [...all, { id: Date.now(), email: em, days: 7 }]);
    setEmail('');
    say('Invite link created for ' + em);
  };
  const toggle = (u: User) => {
    setUsers((all) => all.map((x) => (x.id === u.id ? { ...x, active: !x.active } : x)));
    say(u.active ? u.name + ' can’t sign in now. Their documents stay put.' : u.name + ' can sign in again');
  };
  const copy = (v: Invite) => {
    try { navigator.clipboard.writeText('https://spinel.example/invite/' + v.id); } catch {}
    say('Invite link copied');
  };

  return (
    <main className="main">
      <div>
        <h1>People on this instance</h1>
        <p className="mu" style={{ margin: '4px 0 0' }}>You're signed in as the admin account. It manages people and passkeys, and can't open anyone's documents.</p>
      </div>
      <form className="card row" style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }} onSubmit={invite} noValidate>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 260px' }}>
          <strong>Invite someone</strong>
          <input className="inp" type="email" placeholder="jo@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }} aria-invalid={!!error} aria-describedby="invite-error" />
        </label>
        <button className="btn pri" type="submit"><Icon name="mail" />Create invite link</button>
        {error && <p className="error" id="invite-error">{error}</p>}
      </form>
      {invites.length > 0 && (
        <section aria-label="Pending invites" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="label">Pending invites</div>
          {invites.map((v) => (
            <div key={v.id} className="card dashed">
              <span className="av alt"><Icon name="mail" /></span>
              <div style={{ flex: '1 1 200px' }}><strong>{v.email}</strong><div className="mu">Single-use link · expires in {v.days} days</div></div>
              <button className="btn" onClick={() => copy(v)}>Copy link</button>
              <button className="btn" onClick={() => { setInvites((all) => all.filter((x) => x.id !== v.id)); say('Invite revoked'); }}>Revoke</button>
            </div>
          ))}
        </section>
      )}
      <section aria-label="Users" className="people">
        {users.map((u) => (
          <div key={u.id} className="card" style={{ opacity: u.active ? 1 : 0.7 }}>
            <div className="row">
              <Avatar user={u} />
              <div style={{ flex: 1, minWidth: 0 }}><strong>{u.name}</strong><div className="mu small">{u.email}</div></div>
              <span className="tag">{u.active ? 'Active' : 'Disabled'}</span>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {u.keys.map((k) => <span key={k} className="tag"><Icon name="key" style={{ width: 14, height: 14 }} />{k}</span>)}
              {u.keys.length === 0 && <span className="mu small">No passkeys</span>}
            </div>
            <div><button className="btn" onClick={() => toggle(u)}>{u.active ? 'Disable' : 'Enable'}</button></div>
          </div>
        ))}
      </section>
    </main>
  );
}

// ---------- Open spreadsheet ----------
const MOVES: Record<string, Pos> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
const clamp = (r: number, c: number): Pos => [Math.max(0, Math.min(ROWS - 1, r)), Math.max(0, Math.min(COLS - 1, c))];

interface SheetProps {
  doc: SheetDoc;
  peer: User;
  updateDoc: (change: (d: SheetDoc) => Partial<SheetDoc>) => void;
  back: () => void;
  say: Say;
}

function Sheet({ doc, peer, updateDoc, back, say }: SheetProps) {
  const [tab, setTab] = useState(0);
  const [anchor, setAnchor] = useState<Pos>([1, 1]);
  const [focus, setFocus] = useState<Pos>([1, 1]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [palette, setPalette] = useState(false);
  const [lastFill, setLastFill] = useState('primary-soft');
  const [history, setHistory] = useState<Tab[][]>([]);
  const [sam, setSam] = useState<Pos>([3, 2]);
  const [ping, setPing] = useState(false);
  const dragging = useRef(false);
  const editingRef = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);

  const cells = doc.tabs[tab].cells;
  const raw = (r: number, c: number) => cells[key(r, c)]?.v ?? '';
  const [fr, fc] = focus;
  const r1 = Math.min(anchor[0], fr), r2 = Math.max(anchor[0], fr), c1 = Math.min(anchor[1], fc), c2 = Math.max(anchor[1], fc);
  const inRange = (r: number, c: number) => r >= r1 && r <= r2 && c >= c1 && c <= c2;

  useEffect(() => { if (!editing) setDraft(raw(fr, fc)); }, [fr, fc, tab, doc]);
  useEffect(() => {
    const t = setInterval(() => setSam([1 + Math.floor(Math.random() * 12), 1 + Math.floor(Math.random() * 6)]), 3500);
    const up = () => { dragging.current = false; };
    window.addEventListener('mouseup', up);
    return () => { clearInterval(t); window.removeEventListener('mouseup', up); };
  }, []);

  const mutate = (fn: (cs: Cells) => void) => {
    const tabs = structuredClone(doc.tabs);
    fn(tabs[tab].cells);
    setHistory((h) => [...h.slice(-29), doc.tabs]);
    updateDoc(() => ({ tabs }));
  };
  const eachInRange = (cs: Cells, fn: (x: Cell) => void) => {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) fn((cs[key(r, c)] ??= { v: '' }));
  };
  const select = (r: number, c: number, extend?: boolean) => {
    [r, c] = clamp(r, c);
    setFocus([r, c]);
    if (!extend) setAnchor([r, c]);
  };
  // Clicking someone's presence circle selects their cell and scrolls it into view.
  const jumpTo = ([r, c]: Pos) => {
    if (editingRef.current) commit();
    select(r, c);
    setPing(true);
    setTimeout(() => setPing(false), 900);
    requestAnimationFrame(() => {
      gridRef.current?.querySelector(`[data-cell="${r},${c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      gridRef.current?.focus({ preventScroll: true });
    });
  };
  const startEdit = (initial: string) => { editingRef.current = true; setEditing(true); setDraft(initial); };
  const commit = (move?: 'down' | 'right') => {
    if (!editingRef.current && move === undefined) return;
    editingRef.current = false;
    setEditing(false);
    if (draft !== raw(fr, fc)) mutate((cs) => { cs[key(fr, fc)] = { ...cs[key(fr, fc)], v: draft }; });
    if (move === 'down') select(fr + 1, fc);
    if (move === 'right') select(fr, fc + 1);
    gridRef.current?.focus();
  };
  const cancel = () => { editingRef.current = false; setEditing(false); setDraft(raw(fr, fc)); gridRef.current?.focus(); };

  let sum = 0, count = 0, allBold = true, allItalic = true;
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
    const x = evaluate(cells, r, c);
    if (typeof x === 'number') { sum += x; count++; }
    if (!cells[key(r, c)]?.b) allBold = false;
    if (!cells[key(r, c)]?.i) allItalic = false;
  }
  const toggleBold = () => mutate((cs) => eachInRange(cs, (x) => { x.b = !allBold; }));
  const toggleItalic = () => mutate((cs) => eachInRange(cs, (x) => { x.i = !allItalic; }));
  const applyFill = (f: string | null) => { mutate((cs) => eachInRange(cs, (x) => { if (f) x.f = f; else delete x.f; })); if (f) setLastFill(f); setPalette(false); gridRef.current?.focus(); };
  const undo = () => {
    if (!history.length) return say('Nothing to undo');
    updateDoc(() => ({ tabs: history[history.length - 1] }));
    setHistory((h) => h.slice(0, -1));
  };

  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const mod = e.metaKey || e.ctrlKey, k = e.key;
    if (mod && k.toLowerCase() === 'b') { e.preventDefault(); return toggleBold(); }
    if (mod && k.toLowerCase() === 'i') { e.preventDefault(); return toggleItalic(); }
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); return undo(); }
    if (MOVES[k]) { e.preventDefault(); return select(fr + MOVES[k][0], fc + MOVES[k][1], e.shiftKey); }
    if (k === 'Enter' || k === 'F2') { e.preventDefault(); return startEdit(raw(fr, fc)); }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); return mutate((cs) => eachInRange(cs, (x) => { x.v = ''; })); }
    if (k === 'Escape') return setPalette(false);
    if (k.length === 1 && !mod) { e.preventDefault(); startEdit(k); }
  };
  const onEditKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit('down'); }
    else if (e.key === 'Tab') { e.preventDefault(); commit('right'); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };
  const addTab = () => {
    updateDoc((d) => ({ tabs: [...d.tabs, blankTab('Sheet ' + (d.tabs.length + 1))] }));
    setTab(doc.tabs.length); setAnchor([0, 0]); setFocus([0, 0]); setHistory([]);
  };
  const pickTab = (n: number) => { setTab(n); setAnchor([0, 0]); setFocus([0, 0]); setHistory([]); setEditing(false); editingRef.current = false; };
  const selRef = r1 === r2 && c1 === c2 ? ref(fr, fc) : ref(r1, c1) + ':' + ref(r2, c2);

  return (
    <main className="main sheet">
      <div className="row sheethead">
        <button className="btn sq" onClick={back} aria-label="Back to your docs"><Icon name="back" /></button>
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <input className="inp title-inp" aria-label="Document name" value={doc.name} onChange={(e) => updateDoc(() => ({ name: e.target.value }))} />
          <div className="mu small" style={{ padding: '0 7px' }}>{doc.folder} · Saved</div>
        </div>
        <div className="presence">
          <button className={`pchip fill-${peer.color}`} onClick={() => jumpTo(sam)} aria-label={`${peer.name} is in ${ref(...sam)}. Go to their cell`}>
            <span className="pchip-name">{peer.name} <span className="where">· {ref(...sam)}</span></span>
            <span className="pchip-icon"><LucideIcon name={peer.icon} size={18} /></span>
          </button>
        </div>
        <button className="btn pri" onClick={() => say('Sharing with specific people comes in SPN-015')}>Share</button>
      </div>

      <div className="row toolbar" style={{ gap: 6 }} role="toolbar" aria-label="Formatting">
        <button className="btn sq" style={{ fontWeight: 700 }} aria-label="Bold" aria-pressed={allBold} onClick={toggleBold}>B</button>
        <button className="btn sq" style={{ fontStyle: 'italic' }} aria-label="Italic" aria-pressed={allItalic} onClick={toggleItalic}>I</button>
        <button className="btn" aria-label="Fill colour" aria-expanded={palette} onClick={() => setPalette(!palette)}><Icon name="fill" /><span className={'swatch-btn fill-' + lastFill} /></button>
        <button className="btn" onClick={undo}>Undo</button>
        <span className="mu small" style={{ marginLeft: 'auto' }}>{count > 1 ? `Sum ${fmt(sum)} · Count ${count}` : ''}</span>
        {palette && (
          <div className="card palette" role="dialog" aria-label="Fill colours">
            <div className="palette-grid">
              {PRESETS.map((p, n) => (
                <div key={p} className="pcol">
                  <span className="mu name">{PRESET_NAMES[n]}</span>
                  {['soft', 'strong'].map((kind) => (
                    <button key={kind} className={`swatch fill-${p}-${kind}`} aria-label={`${PRESET_NAMES[n]}, ${kind}`} title={`${PRESET_NAMES[n]}, ${kind}`} onClick={() => applyFill(`${p}-${kind}`)}>Aa</button>
                  ))}
                </div>
              ))}
            </div>
            <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => applyFill(null)}>No fill</button>
          </div>
        )}
      </div>

      <div className="fbar">
        <span className="mu" style={{ fontWeight: 700, minWidth: 36 }}>{selRef}</span>
        <input aria-label="Cell contents" value={draft} onChange={(e) => { editingRef.current = true; setDraft(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit('down'); } else if (e.key === 'Escape') cancel(); }} />
      </div>

      <div className="gridbox" role="grid" aria-label="Spreadsheet" tabIndex={0} ref={gridRef} onKeyDown={onGridKey}>
        <div className="grid">
          <div className="hcell" />
          {[...LETTERS].map((l) => <div key={l} className="hcell">{l}</div>)}
          {Array.from({ length: ROWS }, (_, r) => (
            <React.Fragment key={r}>
              <div className="hcell" style={{ position: 'static' }}>{r + 1}</div>
              {Array.from({ length: COLS }, (_, c) => {
                const cell: Partial<Cell> = cells[key(r, c)] ?? {}, val = evaluate(cells, r, c);
                const isFocus = r === fr && c === fc, isEditing = isFocus && editing, isSam = r === sam[0] && c === sam[1];
                const cls = ['cell', typeof val === 'number' && 'num', cell.b && 'b', cell.i && 'it', cell.f && 'fill-' + cell.f, inRange(r, c) && !isFocus && 'inr', isSam && 'peer', isSam && ping && 'ping', isFocus && 'sel'].filter(Boolean).join(' ');
                return (
                  <div key={c} className={cls} role="gridcell" aria-selected={inRange(r, c)} data-cell={r + ',' + c} style={isSam ? ({ '--peer': `var(--fill-${peer.color}-bg)` } as React.CSSProperties) : undefined}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (editingRef.current) commit();
                      select(r, c, e.shiftKey);
                      dragging.current = !e.shiftKey;
                      gridRef.current?.focus();
                    }}
                    onMouseEnter={() => { if (dragging.current) setFocus([r, c]); }}
                    onDoubleClick={() => startEdit(raw(r, c))}>
                    {isEditing
                      ? <input autoFocus aria-label="Edit cell" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onEditKey} onBlur={() => commit()} />
                      : <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{fmt(val)}</span>}
                    {isSam && <Avatar user={peer} size={18} label={`${peer.name} is here`} />}
                  </div>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="row" style={{ gap: 6 }}>
        {doc.tabs.map((t, n) => <button key={n} className={'chip ' + (n === tab ? 'on' : '')} aria-pressed={n === tab} onClick={() => pickTab(n)}>{t.name}</button>)}
        <button className="chip" onClick={addTab} aria-label="Add a sheet">+</button>
        <span className="mu small hint" style={{ marginLeft: 'auto' }}>Double-click or type to edit. Shift-click or drag to select. Try =SUM(B2:B5) or =B2*12</span>
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);
