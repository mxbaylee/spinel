// Backlog rules shared by the CLI and its tests. No runtime dependencies, so CI
// can run it before anything is installed. The rules themselves are explained in
// docs/todo/process.md; this file only enforces them.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, posix } from 'node:path';

export type Size = 'S' | 'M' | 'L';
type Scalar = string | number | boolean;
export type Value = Scalar | Scalar[];

export interface BacklogConfig {
  name: string;
  prefix: string;
  next_id: number;
  personas: string;
  grooming: { every: number; last?: string; completed_since: string[] };
  size: { soft: number; hard: number; exclude: string[] };
  pr_title_exceptions: string[];
}

// Fields are typed as validateTicket requires them; it reports any ticket
// whose frontmatter says otherwise, and nothing else runs on a failing backlog.
export interface Ticket {
  file: string;
  errors: string[];
  warnings: string[];
  id: string;
  emoji: string;
  effort: Size;
  impact: Size;
  must_ship: boolean;
  depends_on: string[];
  decisions: number[];
  owner_input: string;
  body: string;
  lineCount: number;
  heading: string;
  title: string;
}

export interface Backlog {
  config: BacklogConfig;
  tickets: Ticket[];
  strays: string[];
  personasText: string | null;
  index?: string | null;
}

export interface BacklogIO {
  read(path: string): string;
  exists(path: string): boolean;
  list(dir: string): string[];
}

export interface Result {
  errors: string[];
  warnings: string[];
}

export const CONFIG_PATH = 'docs/todo/backlog.json';
export const SIZES: readonly string[] = ['S', 'M', 'L'];
export const EFFORT_POINTS: Record<Size, number> = { S: 3, M: 2, L: 1 };
export const IMPACT_POINTS: Record<Size, number> = { S: 1, M: 2, L: 3 };
export const EFFORT_EMOJI: Record<Size, string> = { S: '🌱', M: '🌿', L: '🌳' };
export const IMPACT_EMOJI: Record<Size, string> = { S: '🤍', M: '💜', L: '🩷' };
export const MUST_SHIP_EMOJI = '💎';
// Marks with a fixed meaning elsewhere; a ticket can't use them as its emoji.
export const RESERVED_EMOJI = new Set<string>([
  ...Object.values(EFFORT_EMOJI),
  ...Object.values(IMPACT_EMOJI),
  MUST_SHIP_EMOJI,
  '🧹',
  '⬆️',
  '❓',
]);
export const MAX_TICKET_LINES = 50;
const REQUIRED_SECTIONS = ['Story', 'Scenarios', 'Verify'];
const KNOWN_SECTIONS = ['Story', 'Scenarios', 'Rules', 'Out of scope', 'Verify'];
const FIELDS = ['id', 'emoji', 'effort', 'impact', 'must_ship', 'depends_on', 'decisions', 'owner_input'];
const SINGLE_EMOJI = /^\p{RGI_Emoji}$/v;
const INDEX_FILES = new Set(['readme.md', 'process.md', 'backlog.json']);

// ---------- parsing ----------

// A deliberately small YAML subset: `key: value` lines, where value is a
// [list], true/false, an integer, a "quoted string" or a bare string. Anything
// richer is an error rather than a guess.
export type Frontmatter =
  | { error: string; data?: undefined; body?: undefined }
  | { error?: undefined; data: Record<string, Value>; body: string; bodyStartLine: number };

export function parseFrontmatter(text: string): Frontmatter {
  if (!text.startsWith('---\n')) return { error: 'missing frontmatter (the file must start with ---)' };
  const end = text.indexOf('\n---\n', 3);
  if (end < 0) return { error: 'frontmatter is not closed with ---' };
  const data: Record<string, Value> = {};
  const lines = text.slice(4, end).split('\n');
  for (const [i, raw] of lines.entries()) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const m = /^([a-z_]+):\s*(.*)$/.exec(raw);
    if (!m) return { error: `frontmatter line ${i + 2} is not "key: value"` };
    const [, key, rest] = m;
    if (key in data) return { error: `frontmatter line ${i + 2} repeats "${key}"` };
    const value = parseValue(rest);
    if (value === undefined) return { error: `frontmatter line ${i + 2} has a value I can't read: ${rest}` };
    data[key] = value;
  }
  return { data, body: text.slice(end + 5), bodyStartLine: lines.length + 3 };
}

function parseValue(rest: string): Value | undefined {
  let s = rest.trim();
  if (s.startsWith('"')) {
    const close = s.indexOf('"', 1);
    if (close < 0) return undefined;
    const tail = s.slice(close + 1).trim();
    if (tail && !tail.startsWith('#')) return undefined;
    return s.slice(1, close);
  }
  s = s.replace(/\s+#\s.*$/, '').trim();
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) return undefined;
    const inner = s.slice(1, -1).trim();
    return inner ? inner.split(',').map((v) => scalar(v.trim())) : [];
  }
  return scalar(s);
}

function scalar(s: string): Scalar {
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^\d+$/.test(s)) return Number(s);
  return s;
}

export function slugify(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');
}

export function headingAnchors(markdown: string): Set<string> {
  const anchors = new Set<string>();
  for (const line of markdown.split('\n')) {
    const m = /^#{1,6}\s+(.*)$/.exec(line);
    if (m) anchors.add(slugify(m[1]));
    for (const a of line.matchAll(/<a id="([^"]+)"><\/a>/g)) anchors.add(a[1]);
  }
  return anchors;
}

export function parseTicket(file: string, text: string): Ticket {
  const t = { file, errors: [] as string[], warnings: [] as string[] } as Ticket;
  const fm = parseFrontmatter(text);
  if (fm.error !== undefined) {
    t.errors.push(fm.error);
    return t;
  }
  const d = fm.data;
  for (const key of Object.keys(d)) if (!FIELDS.includes(key)) t.errors.push(`unknown frontmatter field "${key}"`);
  Object.assign(t, {
    id: d.id as string,
    emoji: d.emoji as string,
    effort: d.effort as Size,
    impact: d.impact as Size,
    must_ship: d.must_ship as boolean,
    depends_on: (d.depends_on ?? []) as string[],
    decisions: (d.decisions ?? []) as number[],
    owner_input: (d.owner_input ?? '') as string,
    body: fm.body,
    lineCount: text.replace(/\n$/, '').split('\n').length,
  });
  const h1 = fm.body.split('\n').find((l) => l.trim());
  const m = /^# (.+)$/.exec(h1 ?? '');
  t.heading = m ? m[1] : '';
  return t;
}

// ---------- loading ----------

export function loadConfig(root: string): BacklogConfig {
  const path = join(root, CONFIG_PATH);
  if (!existsSync(path)) throw new Error(`${CONFIG_PATH} not found under ${root}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function todoDir(root: string): string {
  return join(root, dirname(CONFIG_PATH));
}

export function ticketFilePattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}-(\\d{3,})\\.md$`);
}

// Reads the backlog from the working tree. `read(relPath)` and `list(relDir)`
// can be swapped for git-backed versions to read another revision.
export function loadBacklog(root: string, io: BacklogIO = fsIO(root)): Backlog {
  const config: BacklogConfig = JSON.parse(io.read(CONFIG_PATH));
  const dir = dirname(CONFIG_PATH);
  const pattern = ticketFilePattern(config.prefix);
  const files = io.list(dir);
  const tickets: Ticket[] = [];
  const strays: string[] = [];
  for (const name of files.sort()) {
    if (pattern.test(name)) tickets.push(parseTicket(name, io.read(posix.join(dir, name))));
    else if (!INDEX_FILES.has(name)) strays.push(name);
  }
  const personasText = io.exists(config.personas) ? io.read(config.personas) : null;
  const index = io.exists(posix.join(dir, 'readme.md')) ? io.read(posix.join(dir, 'readme.md')) : null;
  return { config, tickets, strays, personasText, index };
}

export function fsIO(root: string): BacklogIO {
  return {
    read: (p) => readFileSync(join(root, p), 'utf8'),
    exists: (p) => existsSync(join(root, p)),
    list: (d) => (existsSync(join(root, d)) ? readdirSync(join(root, d)) : []),
  };
}

// ---------- validation ----------

export function idNumber(id: string | undefined, prefix: string): number | null {
  const m = new RegExp(`^${prefix}-(\\d{3,})$`).exec(id ?? '');
  return m ? Number(m[1]) : null;
}

export function formatId(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

interface Context {
  config: BacklogConfig;
  anchors: Set<string> | null;
  personasLink: string;
}

function validateTicket(t: Ticket, ctx: Context): void {
  const { config, anchors } = ctx;
  const prefix = config.prefix;
  if (t.errors.length) return;
  const expectedId = t.file.replace(/\.md$/, '');
  if (t.id !== expectedId) t.errors.push(`id "${t.id}" does not match the filename ${t.file}`);
  const n = idNumber(t.id, prefix);
  if (n !== null && n >= config.next_id)
    t.errors.push(`${t.id} is at or above next_id (${config.next_id}); raise next_id in ${CONFIG_PATH}`);
  if (typeof t.emoji !== 'string' || !SINGLE_EMOJI.test(t.emoji)) t.errors.push('emoji must be exactly one emoji');
  else if (RESERVED_EMOJI.has(t.emoji)) t.errors.push(`${t.emoji} is reserved for sizes or PR types; pick another emoji`);
  if (!SIZES.includes(t.effort)) t.errors.push('effort must be S, M or L');
  if (!SIZES.includes(t.impact)) t.errors.push('impact must be S, M or L');
  if (typeof t.must_ship !== 'boolean') t.errors.push('must_ship must be true or false');
  if (!Array.isArray(t.depends_on)) t.errors.push('depends_on must be a [list]');
  else for (const dep of t.depends_on) if (idNumber(dep, prefix) === null) t.errors.push(`depends_on "${dep}" is not a ${prefix}-NNN ID`);
  if (!Array.isArray(t.decisions) || t.decisions.some((x) => !Number.isInteger(x) || x < 1))
    t.errors.push('decisions must be a [list] of GitHub issue numbers');
  if (typeof t.owner_input !== 'string') t.errors.push('owner_input must be a string');

  const title = t.heading.startsWith(`${t.emoji} ${t.id} `) ? t.heading.slice(`${t.emoji} ${t.id} `.length).trim() : '';
  if (!title) t.errors.push(`the first heading must be "# ${t.emoji} ${t.id} <title>"`);
  t.title = title;

  const sections = [...t.body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  for (const s of REQUIRED_SECTIONS) if (!sections.includes(s)) t.errors.push(`missing "## ${s}" section`);
  for (const s of sections) if (!KNOWN_SECTIONS.includes(s)) t.warnings.push(`unexpected section "## ${s}"`);
  const order = sections.filter((s) => KNOWN_SECTIONS.includes(s)).map((s) => KNOWN_SECTIONS.indexOf(s));
  if (order.some((v, i) => i > 0 && v < order[i - 1]))
    t.errors.push(`sections must run in this order: ${KNOWN_SECTIONS.join(', ')}`);

  const story = sectionText(t.body, 'Story');
  const links = [...story.matchAll(/\]\(([^)#\s]*personas\.md)#([^)\s]+)\)/g)];
  if (!links.length) t.errors.push(`the Story must link a persona, e.g. [Owner](${ctx.personasLink}#owner)`);
  for (const [, path, anchor] of links) {
    if (path !== ctx.personasLink) t.errors.push(`persona link should point at ${ctx.personasLink}, not ${path}`);
    else if (anchors && !anchors.has(anchor)) t.errors.push(`persona anchor #${anchor} is not a heading in ${config.personas}`);
  }

  const scenarios = sectionText(t.body, 'Scenarios').split(/^### /m).slice(1);
  if (sections.includes('Scenarios') && !scenarios.length) t.errors.push('Scenarios needs at least one "### <outcome>" scenario');
  for (const sc of scenarios) {
    const name = sc.split('\n')[0].trim();
    for (const word of ['Given', 'When', 'Then'])
      if (!new RegExp(`^${word}\\b`, 'm').test(sc)) t.errors.push(`scenario "${name}" has no ${word} line`);
  }

  if (t.lineCount > MAX_TICKET_LINES)
    t.warnings.push(`${t.lineCount} lines; tickets aim for ${MAX_TICKET_LINES} or fewer, consider splitting or trimming`);
}

function sectionText(body: string, name: string): string {
  const m = new RegExp(`^## ${name}[ \\t]*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(body);
  return m ? m[1] : '';
}

export function validateBacklog(backlog: Backlog): Result {
  const { config, tickets, strays, personasText } = backlog;
  const errors: string[] = [];
  const warnings: string[] = [];
  const prefix = config.prefix;

  for (const key of ['name', 'prefix', 'next_id', 'personas', 'grooming', 'size', 'pr_title_exceptions'])
    if (config[key as keyof BacklogConfig] === undefined) errors.push(`${CONFIG_PATH}: missing "${key}"`);
  if (errors.length) return { errors, warnings };
  if (!/^[A-Z]{2,6}$/.test(prefix)) errors.push(`${CONFIG_PATH}: prefix must be 2–6 capital letters`);
  if (!Number.isInteger(config.next_id) || config.next_id < 1) errors.push(`${CONFIG_PATH}: next_id must be a positive integer`);

  const anchors = personasText ? headingAnchors(personasText) : null;
  if (!personasText) errors.push(`${config.personas} not found`);
  const personasLink = posix.relative(dirname(CONFIG_PATH), config.personas);
  const ctx = { config, anchors, personasLink };

  for (const s of strays) warnings.push(`docs/todo/${s}: not a ticket or index file; tickets are named ${prefix}-NNN.md`);

  const open = new Map<string, Ticket>();
  for (const t of tickets) {
    validateTicket(t, ctx);
    if (t.id) open.set(t.id, t);
    for (const e of t.errors) errors.push(`${t.file}: ${e}`);
    for (const w of t.warnings) warnings.push(`${t.file}: ${w}`);
  }

  for (const t of tickets) {
    if (!Array.isArray(t.depends_on)) continue;
    for (const dep of t.depends_on) {
      if (dep === t.id) errors.push(`${t.file}: depends on itself`);
      else if (idNumber(dep, prefix) !== null && !open.has(dep))
        errors.push(`${t.file}: depends on ${dep}, which is not an open ticket; remove it if it landed`);
    }
  }
  const cycle = findCycle(tickets.filter((t) => Array.isArray(t.depends_on)));
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' → ')}`);

  const byEmoji = new Map<string, string[]>();
  for (const t of tickets) if (t.emoji) byEmoji.set(t.emoji, [...(byEmoji.get(t.emoji) ?? []), t.id]);
  for (const [emoji, ids] of byEmoji)
    if (ids.length > 1) warnings.push(`${emoji} is shared by ${ids.join(', ')}; give each ticket its own emoji where you can`);

  const g = config.grooming;
  const done = Array.isArray(g.completed_since) ? g.completed_since : null;
  if (!Number.isInteger(g.every) || g.every < 1) errors.push(`${CONFIG_PATH}: grooming.every must be a positive integer`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.last ?? '')) errors.push(`${CONFIG_PATH}: grooming.last must be a YYYY-MM-DD date`);
  if (!done) errors.push(`${CONFIG_PATH}: grooming.completed_since must be a list`);
  else {
    if (new Set(done).size !== done.length) errors.push(`${CONFIG_PATH}: grooming.completed_since has duplicates`);
    if (done.length > g.every) errors.push(`${CONFIG_PATH}: ${done.length} completions since grooming; groom at ${g.every}`);
    for (const id of done) {
      const n = idNumber(id, prefix);
      if (n === null || n >= config.next_id) errors.push(`${CONFIG_PATH}: completed "${id}" is not a used ${prefix} ID`);
      else if (open.has(id)) errors.push(`${CONFIG_PATH}: ${id} is listed as completed but its ticket file still exists`);
    }
  }
  return { errors, warnings };
}

function findCycle(tickets: Ticket[]): string[] | null {
  const deps = new Map(tickets.map((t) => [t.id, t.depends_on]));
  const state = new Map<string, 'active' | 'done'>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    state.set(id, 'active');
    stack.push(id);
    for (const dep of deps.get(id) ?? []) {
      if (!deps.has(dep)) continue;
      if (state.get(dep) === 'active') return [...stack.slice(stack.indexOf(dep)), dep];
      if (!state.has(dep)) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };
  for (const id of deps.keys()) if (!state.has(id)) {
    const found = visit(id);
    if (found) return found;
  }
  return null;
}

// ---------- ranking ----------

export function score(t: Pick<Ticket, 'must_ship' | 'impact' | 'effort'>): number {
  return (t.must_ship ? 3 : 0) + IMPACT_POINTS[t.impact] + EFFORT_POINTS[t.effort];
}

// Ready tickets in pick order, each with the tie-break that put it ahead of
// the next one. A ticket waiting on an open dependency is not ready.
export interface Ranked {
  ticket: Ticket;
  score: number;
  tieBreak: string;
}

export function rank(tickets: Ticket[], prefix: string): Ranked[] {
  const ids = new Set(tickets.map((t) => t.id));
  const unblocks = (t: Ticket) => tickets.filter((o) => o.depends_on.includes(t.id)).map((o) => o.id);
  const keys = (t: Ticket) => ({
    score: score(t),
    unblocks: unblocks(t),
    impact: IMPACT_POINTS[t.impact],
    effort: EFFORT_POINTS[t.effort],
    num: idNumber(t.id, prefix) ?? 0,
  });
  type Entry = { t: Ticket; k: ReturnType<typeof keys> };
  const ready: Entry[] = tickets.filter((t) => !t.depends_on.some((d) => ids.has(d))).map((t) => ({ t, k: keys(t) }));
  const compare = (a: Entry, b: Entry) =>
    b.k.score - a.k.score ||
    Number(b.k.unblocks.length > 0) - Number(a.k.unblocks.length > 0) ||
    b.k.impact - a.k.impact ||
    b.k.effort - a.k.effort ||
    a.k.num - b.k.num;
  ready.sort(compare);
  return ready.map(({ t, k }, i) => {
    const next = ready[i + 1];
    let tieBreak = '—';
    if (next && next.k.score === k.score) {
      if (k.unblocks.length && !next.k.unblocks.length) tieBreak = `Unblocks ${k.unblocks.join(', ')}`;
      else if (k.impact !== next.k.impact) tieBreak = 'Higher impact';
      else if (k.effort !== next.k.effort) tieBreak = 'Lower effort';
      else tieBreak = 'Lower ID';
    }
    return { ticket: t, score: k.score, tieBreak };
  });
}

// ---------- index ----------

export function renderIndex(backlog: Backlog): string {
  const { config, tickets } = backlog;
  const prefix = config.prefix;
  const g = config.grooming;
  const link = (t: Ticket) => `${t.emoji} [${t.id}](${t.file}) ${t.title}`;
  const ids = new Set(tickets.map((t) => t.id));
  const ranked = rank(tickets, prefix);
  const top = ranked.slice(0, 5);
  const done = g.completed_since.length ? `: ${g.completed_since.join(', ')}` : '';
  const out = [
    `# ${config.name} backlog`,
    '',
    `<!-- Generated by \`npm run backlog:index\` from the ${prefix}-NNN.md tickets and backlog.json. Don't edit it by hand; CI fails if it is stale. -->`,
    '',
    `How this backlog works: [process.md](process.md). Next ID: **${formatId(prefix, config.next_id)}**. ` +
      `Grooming: **${g.completed_since.length} of ${g.every}** tickets completed since ${g.last}${done}.`,
    '',
    '## 🏆 Top 5',
    '',
  ];
  if (!top.length) out.push('No ticket is ready to start.');
  else {
    out.push('| # | Ticket | Score | Tie-break | Owner input |', '| --- | --- | --- | --- | --- |');
    top.forEach(({ ticket, score: s, tieBreak }, i) =>
      out.push(`| ${i + 1} | ${link(ticket)} | ${s} | ${tieBreak} | ${ticket.owner_input || 'None'} |`),
    );
  }
  out.push('', `## All open tickets (${tickets.length})`, '');
  if (!tickets.length) out.push('The backlog is empty.');
  else {
    out.push('| Ticket | Effort | Impact | Score | Waiting on |', '| --- | --- | --- | --- | --- |');
    for (const t of [...tickets].sort((a, b) => (idNumber(a.id, prefix) ?? 0) - (idNumber(b.id, prefix) ?? 0))) {
      const waiting = t.depends_on.filter((d) => ids.has(d));
      const s = `${t.must_ship ? `${MUST_SHIP_EMOJI} ` : ''}${score(t)}`;
      out.push(
        `| ${link(t)} | ${EFFORT_EMOJI[t.effort]} ${t.effort} | ${IMPACT_EMOJI[t.impact]} ${t.impact} | ${s} | ${
          waiting.length ? waiting.map((d) => `[${d}](${d}.md)`).join(', ') : '—'
        } |`,
      );
    }
  }
  out.push('');
  return out.join('\n');
}

// ---------- pull requests ----------

export function globToRegExp(glob: string): RegExp {
  const body = glob
    .split(/(\*\*\/|\*\*|\*|\?)/)
    .map((part) => {
      if (part === '**/') return '(?:.*/)?';
      if (part === '**') return '.*';
      if (part === '*') return '[^/]*';
      if (part === '?') return '[^/]';
      return part.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(glob.includes('/') ? `^${body}$` : `(?:^|/)${body}$`);
}

// numstat: lines of `git diff --numstat`. Binary files ("-") count as zero.
export function changedLines(numstat: string, exclude: string[]): { total: number; counted: [string, number][] } {
  const patterns = exclude.map(globToRegExp);
  let total = 0;
  const counted: [string, number][] = [];
  for (const line of numstat.split('\n')) {
    if (!line.trim()) continue;
    const [add, del, ...rest] = line.split('\t');
    const path = normalizeRename(rest.join('\t'));
    if (patterns.some((p) => p.test(path))) continue;
    const n = (Number(add) || 0) + (Number(del) || 0);
    total += n;
    counted.push([path, n]);
  }
  return { total, counted };
}

function normalizeRename(path: string): string {
  // "dir/{old => new}/f" and "old => new"
  return path.replace(/\{[^{}]* => ([^{}]*)\}/, '$1').replace(/^.* => /, '').replace(/\/\//g, '/');
}

// Settings a PR could loosen for itself. Only a grooming PR may change them,
// and every check below reads them from the base branch.
const PROTECTED_SETTINGS = ['name', 'prefix', 'personas', 'grooming.every', 'size', 'pr_title_exceptions'];

function setting(config: BacklogConfig, path: string): string | undefined {
  return JSON.stringify(path.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k], config));
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

// base and head are loaded backlogs. Returns errors and warnings for the PR.
// `today` is YYYY-MM-DD, used to check a grooming PR's date.
export interface PullRequest {
  title: string;
  base: Backlog;
  head: Backlog;
  numstat?: string;
  today?: string;
}

export function checkPullRequest({ title, base, head, numstat, today = new Date().toISOString().slice(0, 10) }: PullRequest): Result {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rules = base.config;
  const prefix = rules.prefix;
  const baseTickets = new Map(base.tickets.map((t) => [t.id, t]));
  const headTickets = new Map(head.tickets.map((t) => [t.id, t]));
  const removed = [...baseTickets.keys()].filter((id) => !headTickets.has(id));
  // Effort-S tickets are low-effort work such as scaffolding, which can be
  // large without being hard to review, so the size limits don't apply.
  let sizeExempt = false;
  const baseDone = rules.grooming?.completed_since ?? [];
  const headDone = head.config.grooming.completed_since;

  if (/[\r\n]/.test(title)) errors.push('the PR title must be one line');
  const exception = rules.pr_title_exceptions.find((p) => title === p || title.startsWith(`${p} `) || title.startsWith(`${p}:`));
  const grooming = Boolean(exception?.startsWith('🧹'));

  if (!grooming) {
    for (const key of PROTECTED_SETTINGS)
      if (setting(rules, key) !== setting(head.config, key)) errors.push(`only a grooming PR may change "${key}" in ${CONFIG_PATH}`);
    if (head.config.grooming.last !== rules.grooming?.last) errors.push(`only a grooming PR may change "grooming.last" in ${CONFIG_PATH}`);
  }

  if (grooming) {
    if (headDone.length) errors.push(`a grooming PR resets grooming.completed_since to [] in ${CONFIG_PATH}`);
    // "Today" when the PR was written; it may sit in review, so only rule out
    // going backwards or into the future.
    const last = head.config.grooming.last;
    const previous = rules.grooming?.last;
    if (last !== undefined && ((previous && last < previous) || (last > today && daysBetween(last, today) > 1)))
      errors.push(`grooming.last is ${last}; a grooming PR sets it to the day of the grooming (today is ${today})`);
  } else if (exception) {
    if (!sameList(headDone, baseDone)) errors.push('only ticket PRs and grooming PRs change grooming.completed_since');
    if (removed.length) errors.push(`only ticket PRs and grooming PRs remove tickets (removed ${removed.join(', ')})`);
  } else {
    const m = new RegExp(`^(\\p{RGI_Emoji}) (${prefix}-\\d{3,}) (\\S.*)$`, 'v').exec(title);
    if (!m) {
      errors.push(
        `the PR title must be "<emoji> ${prefix}-NNN <title>" (e.g. "🪞 ${prefix}-012 Restore a document"), ` +
          `or start with one of: ${rules.pr_title_exceptions.map((p) => `"${p}"`).join(', ')}`,
      );
    } else {
      const [, emoji, id, text] = m;
      const ticket = baseTickets.get(id);
      if (!ticket) errors.push(`${id} is not an open ticket on the base branch`);
      else {
        sizeExempt = ticket.effort === 'S';
        const heading = `${ticket.emoji} ${id} `;
        const ticketTitle = ticket.heading?.startsWith(heading) ? ticket.heading.slice(heading.length).trim() : '';
        if (ticket.emoji !== emoji) errors.push(`${id}'s emoji is ${ticket.emoji}, not ${emoji}`);
        else if (text.trim() !== ticketTitle) errors.push(`the PR title must be the ticket's heading: "${heading}${ticketTitle}"`);
        if (headTickets.has(id))
          errors.push(`${id}.md still exists; a ticket PR lands the ticket, so delete its file (split any remainder into new tickets)`);
        const others = removed.filter((r) => r !== id);
        if (others.length) errors.push(`a ticket PR removes only its own ticket (also removed ${others.join(', ')})`);
        if (baseDone.length >= rules.grooming.every)
          errors.push(`${baseDone.length} tickets have landed since the last grooming; open a "🧹 Groom backlog" PR first`);
        const expected = [...baseDone, id];
        if (!sameList(headDone, expected))
          errors.push(`append ${id} to grooming.completed_since in ${CONFIG_PATH} (expected [${expected.join(', ')}])`);
      }
    }
  }

  if (head.config.next_id < rules.next_id) errors.push(`next_id went down from ${rules.next_id} to ${head.config.next_id}; IDs are never reused`);
  for (const [id] of headTickets)
    if (!baseTickets.has(id) && (idNumber(id, prefix) ?? 0) < rules.next_id)
      errors.push(`${id} reuses an ID below the base next_id (${rules.next_id}); new tickets take next_id`);

  if (numstat !== undefined) {
    const { soft, hard, exclude } = rules.size;
    const { total } = changedLines(numstat, exclude);
    if (total > soft && sizeExempt) warnings.push(`${total} changed lines; effort-S tickets have no size limit`);
    else if (total > hard) errors.push(`${total} changed lines is past the ${hard} hard limit; land the coherent part and split the rest into new tickets`);
    else if (total > soft) warnings.push(`${total} changed lines is past the ${soft} soft limit; consider splitting`);
  }
  return { errors, warnings };
}
