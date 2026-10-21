import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changedLines,
  checkPullRequest,
  globToRegExp,
  parseFrontmatter,
  rank,
  renderIndex,
  baseScore,
  scores,
  staleScores,
  withScore,
  validateBacklog,
  parseTicket,
  type Backlog,
  type BacklogConfig,
  type Effort,
} from '../lib.ts';

const PERSONAS = '# Personas\n\n## Owner\n\n## Link guest\n';

type Fixture = { name: string; text: string };

function ticket(id: string, over: Record<string, string> = {}, body?: string): Fixture {
  const fm = {
    emoji: '🪞',
    effort: 'M',
    impact_owner: 'M',
    score: '4',
    depends_on: '[]',
    decisions: '[]',
    ...over,
  };
  const text =
    `---\nid: ${id}\n` +
    Object.entries(fm)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n') +
    `\n---\n\n` +
    (body ??
      `# ${fm.emoji} ${id} Do the thing\n\n## Story\n\nAs the [Owner](../product/personas.md#owner), I want it, so that it helps.\n\n` +
        `## Scenarios\n\n### It works\n\nGiven a state,\nWhen I act,\nThen it works.\n\n## Verify\n\n- Unit test.\n`);
  return { name: `${id}.md`, text };
}

function config(over: Partial<BacklogConfig> = {}): BacklogConfig {
  return {
    name: 'Test',
    prefix: 'SPN',
    next_id: 10,
    personas: 'docs/product/personas.md',
    grooming: { every: 7, last: '2026-10-17', completed_since: [] },
    size: { soft: 100, hard: 1000, exclude: ['package-lock.json', '**/dist/**'] },
    pr_title_exceptions: ['🧹 Groom backlog', '⬆️ Bump'],
    ...over,
  };
}

// Builds a backlog the same way loadBacklog does, without touching disk.
function backlog(tickets: Fixture[], cfg = config()): Backlog {
  return {
    config: cfg,
    tickets: tickets.map((t) => parseTicket(t.name, t.text)),
    strays: [],
    personasText: PERSONAS,
  };
}

function check(tickets: Fixture[], cfg?: BacklogConfig) {
  return validateBacklog(backlog(tickets, cfg));
}

test('frontmatter reads lists, booleans, numbers, quoted strings and strips comments', () => {
  const { data } = parseFrontmatter(
    '---\neffort: M        # S | M | L | XL\nflag: true\ndepends_on: [SPN-001, SPN-002]\ndecisions: [7]\nowner_input: "Pick # one"\nnote: \'Prettier # quotes\'\n---\nbody',
  );
  assert.deepEqual(data, {
    effort: 'M',
    flag: true,
    depends_on: ['SPN-001', 'SPN-002'],
    decisions: [7],
    owner_input: 'Pick # one',
    note: 'Prettier # quotes',
  });
});

test('a well-formed ticket passes', () => {
  assert.deepEqual(check([ticket('SPN-001')]).errors, []);
});

test('ticket shape errors are reported', () => {
  const cases: [Fixture, RegExp][] = [
    [ticket('SPN-001', { effort: 'XXL' }), /effort must be S, M, L or XL/],
    [ticket('SPN-001', { phase: 'future' }), /phase must be pre_launch, launch or post_launch/],
    [ticket('SPN-001', { emoji: '💎' }), /reserved/],
    [ticket('SPN-001', { emoji: '🏔️' }), /reserved/],
    [ticket('SPN-001', { impact_owner: 'XL' }), /impact_owner must be S, M or L/],
    [ticket('SPN-001', { must_ship: 'true' }), /unknown frontmatter field "must_ship"/],
    [ticket('SPN-001', { score: 'high' }), /score must be a whole number/],
    [ticket('SPN-012'), /at or above next_id/],
    [{ ...ticket('SPN-001'), name: 'SPN-002.md' }, /does not match the filename/],
    [
      ticket('SPN-001', {}, '# 🪞 SPN-001 X\n\n## Story\n\nAs the Owner.\n\n## Verify\n'),
      /missing "## Scenarios"/,
    ],
    [
      ticket(
        'SPN-001',
        {},
        '# 🪞 SPN-001 X\n\n## Story\n\nAs the Owner.\n\n## Scenarios\n\n### a\n\nGiven x\nThen y\n\n## Verify\n',
      ),
      /must link a persona/,
    ],
    [
      ticket(
        'SPN-001',
        {},
        '# 🪞 SPN-001 X\n\n## Story\n\n[O](../product/personas.md#owner)\n\n## Scenarios\n\n### a\n\nGiven x\nThen y\n\n## Verify\n',
      ),
      /no When line/,
    ],
    [
      ticket(
        'SPN-001',
        {},
        '# 🪞 SPN-001 X\n\n## Story\n\n[O](../product/personas.md#nobody)\n\n## Scenarios\n\n### a\n\nGiven x\nWhen z\nThen y\n\n## Verify\n',
      ),
      /#nobody is not a heading/,
    ],
    [
      ticket(
        'SPN-001',
        {},
        '# 🪞 SPN-001 X\n\n## Verify\n\n## Story\n\n[O](../product/personas.md#owner)\n\n## Scenarios\n\n### a\n\nGiven x\nWhen z\nThen y\n',
      ),
      /must run in this order/,
    ],
    [
      ticket(
        'SPN-001',
        {},
        '# Wrong heading\n\n## Story\n\n[O](../product/personas.md#owner)\n\n## Scenarios\n\n### a\n\nGiven x\nWhen z\nThen y\n\n## Verify\n',
      ),
      /first heading/,
    ],
  ];
  for (const [t, pattern] of cases) {
    const { errors } = check([t]);
    assert.ok(
      errors.some((e) => pattern.test(e)),
      `${pattern} not in ${JSON.stringify(errors)}`,
    );
  }
});

test('dependencies must be open tickets and acyclic', () => {
  assert.match(
    check([ticket('SPN-001', { depends_on: '[SPN-005]' })]).errors.join(),
    /not an open ticket/,
  );
  const cyc = check([
    ticket('SPN-001', { depends_on: '[SPN-002]' }),
    ticket('SPN-002', { depends_on: '[SPN-001]', emoji: '🧭' }),
  ]);
  assert.match(cyc.errors.join(), /cycle/);
});

test('dependencies cannot point to a later lifecycle phase, and cycles still fail', () => {
  const fixtures = [
    ticket('SPN-001', { depends_on: '[SPN-002]' }),
    ticket('SPN-002', { phase: 'launch', depends_on: '[SPN-003]', emoji: '🧭' }),
    ticket('SPN-003', { phase: 'post_launch', emoji: '🧪' }),
  ];
  const result = check(fixtures);
  assert.match(
    result.errors.join(),
    /pre_launch work cannot depend on SPN-002 in the later launch phase/,
  );
  assert.match(
    result.errors.join(),
    /launch work cannot depend on SPN-003 in the later post_launch phase/,
  );

  const cycle = check([
    ticket('SPN-001', { depends_on: '[SPN-002]' }),
    ticket('SPN-002', { phase: 'launch', depends_on: '[SPN-001]', emoji: '🧭' }),
  ]);
  assert.match(cycle.errors.join(), /dependency cycle/);
  assert.match(cycle.errors.join(), /later launch phase/);
});

test('grooming counter must reference landed IDs', () => {
  const cfg = config({ grooming: { every: 7, last: '2026-10-17', completed_since: ['SPN-001'] } });
  assert.match(check([ticket('SPN-001')], cfg).errors.join(), /still exists/);
  const over = config({
    grooming: { every: 1, last: '2026-10-17', completed_since: ['SPN-002', 'SPN-003'] },
  });
  assert.match(check([], over).errors.join(), /groom at 1/);
});

test('long tickets and shared emoji warn without failing', () => {
  const long = ticket('SPN-001');
  long.text += '\n'.repeat(60);
  const r = check([long, ticket('SPN-002')]);
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings.join(), /lines/);
  assert.match(r.warnings.join(), /shared by SPN-001, SPN-002/);
});

test('a ticket judges at least one persona, and its impact is the highest', () => {
  const none = ticket('SPN-001', {}, undefined);
  none.text = none.text.replace('impact_owner: M\n', '');
  assert.match(check([none]).errors.join(), /judge at least one persona/);
  const mixed = backlog([ticket('SPN-001', { impact_operator: 'S', impact_guest: 'L' })])
    .tickets[0];
  assert.equal(mixed.impact, 'L');
  assert.deepEqual(mixed.impacts, { impact_owner: 'M', impact_operator: 'S', impact_guest: 'L' });
});

test('XL effort is accepted without expanding persona impact sizes', () => {
  assert.deepEqual(check([ticket('SPN-001', { effort: 'XL' })]).errors, []);
  for (const field of ['impact_owner', 'impact_operator', 'impact_collaborator', 'impact_guest']) {
    const result = check([ticket('SPN-001', { effort: 'XL', [field]: 'XL' })]);
    assert.ok(result.errors.some((error) => error.includes(`${field} must be S, M or L`)));
  }
});

test('own points run from 1 to 6, with XL one point below L', () => {
  // XL extends the existing effort scale; prerequisites inherit priority separately.
  assert.equal(baseScore({ impact: 'L', effort: 'S' }), 6);
  assert.equal(baseScore({ impact: 'S', effort: 'L' }), 2);
  assert.equal(baseScore({ impact: 'S', effort: 'XL' }), 1);
  assert.equal(baseScore({ impact: 'M', effort: 'XL' }), 2);
  assert.equal(baseScore({ impact: 'L', effort: 'XL' }), 3);
});

test('a prerequisite scores one above everything that depends on it, up the chain', () => {
  const b = backlog([
    ticket('SPN-001', { impact_owner: 'S', effort: 'L' }), // own 2, under 002
    ticket('SPN-002', { impact_owner: 'S', effort: 'L', depends_on: '[SPN-001]', emoji: '🧭' }), // own 2, under 003
    ticket('SPN-003', { impact_owner: 'M', effort: 'M', depends_on: '[SPN-002]', emoji: '🧪' }), // own 4
    ticket('SPN-004', { impact_owner: 'L', effort: 'S', depends_on: '[SPN-001]', emoji: '🪴' }), // own 6
  ]);
  assert.deepEqual(Object.fromEntries(scores(b.tickets)), {
    'SPN-001': 7,
    'SPN-002': 5,
    'SPN-003': 4,
    'SPN-004': 6,
  });
});

test('a written score that differs is stale, and withScore rewrites or adds it', () => {
  const [t] = backlog([ticket('SPN-001', { score: '9' })]).tickets;
  assert.match(staleScores([t]).errors.join(), /score is 9, should be 4/);
  assert.match(withScore(ticket('SPN-001').text, 7), /\nscore: 7\n/);
  const bare = ticket('SPN-001').text.replace('score: 4\n', '');
  assert.match(withScore(bare, 4), /impact_owner: M\nscore: 4\ndepends_on/);
  const [missing] = backlog([{ name: 'SPN-001.md', text: bare }]).tickets;
  assert.match(staleScores([missing]).errors.join(), /score is missing, should be 4/);
});

test('ranking orders every open ticket by score and applies tie-breaks in order', () => {
  const b = backlog([
    ticket('SPN-001', { impact_owner: 'S', effort: 'L' }), // 2, raised to 4 by 004
    ticket('SPN-002', { impact_owner: 'L', effort: 'L', emoji: '🧭' }), // 4, higher impact than 005
    ticket('SPN-003', { impact_owner: 'S', effort: 'S', emoji: '🧪' }), // 4, last: lowest impact
    ticket('SPN-004', { impact_owner: 'S', effort: 'M', depends_on: '[SPN-001]', emoji: '🪴' }), // 3, waiting
    ticket('SPN-005', { emoji: '🔭' }), // 4, beats 006 on ID
    ticket('SPN-006', { emoji: '🪁' }), // 4, higher impact than 003
    ticket('SPN-007', { impact_owner: 'L', effort: 'S', emoji: '🎒' }), // 6
  ]);
  const ranked = rank(b.tickets, 'SPN');
  assert.deepEqual(
    ranked.map((r) => [r.ticket.id, r.tieBreak]),
    [
      ['SPN-007', '—'],
      ['SPN-001', 'Unblocks SPN-004'],
      ['SPN-002', 'Higher impact'],
      ['SPN-005', 'Lower ID'],
      ['SPN-006', 'Higher impact'],
      ['SPN-003', '—'],
      ['SPN-004', '—'],
    ],
  );
  assert.deepEqual(ranked.at(-1)?.waiting, ['SPN-001']);
});

test('a prerequisite outranks a higher-scoring dependent, so the first row is ready', () => {
  const b = backlog([
    ticket('SPN-001', { impact_owner: 'S', effort: 'L' }), // own 2
    ticket('SPN-002', { impact_owner: 'L', effort: 'S', depends_on: '[SPN-001]', emoji: '🧭' }), // own 6
  ]);
  const ranked = rank(b.tickets, 'SPN');
  assert.deepEqual(
    ranked.map((r) => [r.ticket.id, r.score, r.waiting]),
    [
      ['SPN-001', 7, []],
      ['SPN-002', 6, ['SPN-001']],
    ],
  );
});

test('XL work keeps inherited priority while independent XL work ranks below equivalent L work', () => {
  const b = backlog([
    ticket('SPN-001', { impact_owner: 'S', effort: 'XL' }),
    ticket('SPN-002', { impact_owner: 'M', effort: 'XL', depends_on: '[SPN-001]', emoji: '🧭' }),
    ticket('SPN-003', { impact_owner: 'L', effort: 'S', depends_on: '[SPN-002]', emoji: '🧪' }),
    ticket('SPN-004', { impact_owner: 'S', effort: 'XL', emoji: '🪴' }),
    ticket('SPN-005', { impact_owner: 'S', effort: 'L', emoji: '🔭' }),
  ]);
  assert.deepEqual(validateBacklog(b).errors, []);
  assert.deepEqual(
    rank(b.tickets, 'SPN').map((r) => [r.ticket.id, r.score, r.waiting]),
    [
      ['SPN-001', 8, []],
      ['SPN-002', 7, ['SPN-001']],
      ['SPN-003', 6, ['SPN-002']],
      ['SPN-005', 2, []],
      ['SPN-004', 1, []],
    ],
  );
  const index = renderIndex(b);
  assert.match(index, /SPN-001\.md\) Do the thing \| 🏔️ XL \| 🤍 S \| 8 \(own 1\)/);
  assert.match(index, /SPN-004\.md\) Do the thing \| 🏔️ XL \| 🤍 S \| 1 \|/);
  assert.doesNotMatch(index, /undefined|NaN/);
});

test('lifecycle phases precede scores while preserving priority and dependency inheritance', () => {
  // Launch stays after even the lowest-scoring launch prerequisite, per owner sequencing.
  const b = backlog([
    ticket('SPN-001', { impact_owner: 'S', effort: 'XL' }),
    ticket('SPN-002', { phase: 'launch', impact_owner: 'S', effort: 'XL', emoji: '🧭' }),
    ticket('SPN-003', {
      phase: 'post_launch',
      impact_owner: 'L',
      effort: 'S',
      depends_on: '[SPN-002]',
      emoji: '🧪',
    }),
    ticket('SPN-004', { emoji: '🪴' }),
    ticket('SPN-005', { phase: 'post_launch', impact_owner: 'S', effort: 'XL', emoji: '🔭' }),
  ]);
  assert.deepEqual(validateBacklog(b).errors, []);
  assert.deepEqual(
    rank(b.tickets, 'SPN').map((r) => [r.ticket.id, r.score, r.waiting]),
    [
      ['SPN-004', 4, []],
      ['SPN-001', 1, []],
      ['SPN-002', 7, []],
      ['SPN-003', 6, ['SPN-002']],
      ['SPN-005', 1, []],
    ],
  );
  const index = renderIndex(b);
  assert.match(index, /## Open tickets \(5\)/);
  assert.deepEqual(
    [...index.matchAll(/^### (.+)$/gm)].map((m) => m[1]),
    ['Before launch', 'Launch', 'After launch'],
  );
  assert.equal(index.split('| # | Ticket |').length - 1, 3);
  assert.match(index, /\| 3 \| 🧭 \[SPN-002\]/);
  assert.match(index, /\| 4 \| 🧪 \[SPN-003\]/);
});

test('phase boundaries do not report misleading score tie-breaks', () => {
  const b = backlog([ticket('SPN-002'), ticket('SPN-001', { phase: 'launch', emoji: '🧭' })]);
  assert.deepEqual(validateBacklog(b).errors, []);
  assert.deepEqual(
    rank(b.tickets, 'SPN').map((r) => [r.ticket.id, r.tieBreak]),
    [
      ['SPN-002', '—'],
      ['SPN-001', '—'],
    ],
  );
});

test('omitting phase keeps the existing pre-launch index and ranking', () => {
  const implicit = backlog([ticket('SPN-001')]);
  const explicit = backlog([ticket('SPN-001', { phase: 'pre_launch' })]);
  assert.deepEqual(validateBacklog(implicit).errors, []);
  assert.deepEqual(validateBacklog(explicit).errors, []);
  assert.equal(implicit.tickets[0].phase, 'pre_launch');
  assert.equal(renderIndex(implicit), renderIndex(explicit));
  assert.match(renderIndex(implicit), /Highest score first/);
  assert.doesNotMatch(renderIndex(implicit), /^### /m);
});

test('an empty backlog says so', () => {
  assert.match(renderIndex(backlog([])), /## Open tickets \(0\)\n\nThe backlog is empty\./);
});

test('the index lists every open ticket in pick order', () => {
  const b = backlog([
    ticket('SPN-001', { owner_input: '"Tap the passkey prompt"' }),
    ticket('SPN-002', { depends_on: '[SPN-001]', emoji: '🧭' }),
  ]);
  validateBacklog(b);
  const index = renderIndex(b);
  assert.match(
    index,
    /\| 1 \| 🪞 \[SPN-001\]\(SPN-001.md\) Do the thing \| 🌿 M \| 💜 M \| 5 \(own 4\) \| — \| — \| Tap the passkey prompt \|/,
  );
  assert.match(
    index,
    /\| 2 \| 🧭 \[SPN-002\]\(SPN-002.md\) Do the thing \| 🌿 M \| 💜 M \| 4 \| — \| \[SPN-001\]\(SPN-001.md\) \| — \|/,
  );
  assert.match(index, /Next ID: \*\*SPN-010\*\*/);
  assert.doesNotMatch(index, /Top 5/);
});

test('globs match lockfiles anywhere and directory patterns by path', () => {
  assert.ok(globToRegExp('package-lock.json').test('web/package-lock.json'));
  assert.ok(globToRegExp('**/dist/**').test('dist/a.js'));
  assert.ok(globToRegExp('**/dist/**').test('web/dist/a/b.js'));
  assert.ok(!globToRegExp('**/dist/**').test('src/distance.ts'));
  assert.ok(globToRegExp('*.lock').test('yarn.lock'));
});

test('changed lines skip excluded files, binaries and follow renames', () => {
  const numstat =
    '10\t5\tsrc/a.ts\n900\t0\tpackage-lock.json\n-\t-\timg.png\n3\t1\tsrc/{old => new}/b.ts\n';
  const { total, counted } = changedLines(numstat, ['package-lock.json']);
  assert.equal(total, 19);
  assert.deepEqual(
    counted.map(([p]) => p),
    ['src/a.ts', 'img.png', 'src/new/b.ts'],
  );
});

interface PrOptions {
  base?: Fixture[];
  head?: Fixture[];
  baseCfg?: BacklogConfig;
  headCfg?: BacklogConfig;
  numstat?: string;
}

function pr(
  title: string,
  {
    base = [ticket('SPN-001')],
    head = [],
    baseCfg = config(),
    headCfg,
    numstat = '',
  }: PrOptions = {},
) {
  headCfg ??= config({ grooming: { every: 7, last: '2026-10-17', completed_since: ['SPN-001'] } });
  return checkPullRequest({
    title,
    base: backlog(base, baseCfg),
    head: backlog(head, headCfg),
    numstat,
    today: '2026-10-17',
  });
}

test('a ticket PR lands its ticket and advances the grooming count', () => {
  assert.deepEqual(pr('🪞 SPN-001 Do the thing').errors, []);
});

test('ticket PR title problems', () => {
  assert.match(
    pr('feat(SPN-001): Do the thing').errors.join(),
    /must be "<emoji> SPN-NNN <title>"/,
  );
  assert.match(pr('🧭 SPN-001 Do the thing').errors.join(), /emoji is 🪞/);
  assert.match(pr('🪞 SPN-003 Nope').errors.join(), /not an open ticket/);
  assert.match(
    pr('🪞 SPN-001 Do the thing', { head: [ticket('SPN-001')] }).errors.join(),
    /still exists/,
  );
  assert.match(
    pr('🪞 SPN-001 Do the thing', { headCfg: config() }).errors.join(),
    /append SPN-001/,
  );
  assert.match(pr('🪞 SPN-001 Do\nit').errors.join(), /one line/);
  assert.match(
    pr('🪞 SPN-001 Something else').errors.join(),
    /must be the ticket's heading: "🪞 SPN-001 Do the thing"/,
  );
});

test('ticket PRs wait for grooming once the count is reached', () => {
  const full = ['SPN-002', 'SPN-003', 'SPN-004', 'SPN-005', 'SPN-006', 'SPN-007', 'SPN-008'];
  const baseCfg = config({ grooming: { every: 7, last: '2026-10-17', completed_since: full } });
  assert.match(pr('🪞 SPN-001 Do the thing', { baseCfg }).errors.join(), /Groom backlog/);
  const groomed = pr('🧹 Groom backlog', { baseCfg, headCfg: config(), head: [ticket('SPN-001')] });
  assert.deepEqual(groomed.errors, []);
  const notReset = pr('🧹 Groom backlog after SPN-008', {
    baseCfg,
    headCfg: baseCfg,
    head: [ticket('SPN-001')],
  });
  assert.match(notReset.errors.join(), /resets grooming/);
});

test('exception PRs leave the grooming count alone', () => {
  const r = pr('⬆️ Bump vite from 6.0.0 to 6.1.0', {
    head: [ticket('SPN-001')],
    headCfg: config(),
  });
  assert.deepEqual(r.errors, []);
  assert.match(pr('⬆️ Bump vite', { head: [ticket('SPN-001')] }).errors.join(), /only ticket PRs/);
  assert.match(pr('⬆️ Bumpy').errors.join(), /must be/);
});

test('IDs are never reused', () => {
  const head = [ticket('SPN-001'), ticket('SPN-004', { emoji: '🧭' })];
  const r = pr('🧹 Groom backlog', { head, headCfg: config() });
  assert.match(r.errors.join(), /reuses an ID/);
  const down = pr('🧹 Groom backlog', {
    head: [ticket('SPN-001')],
    headCfg: config({ next_id: 5 }),
  });
  assert.match(down.errors.join(), /next_id went down/);
});

test('PR size: soft limit warns, hard limit fails', () => {
  const groom = { head: [ticket('SPN-001')], headCfg: config() };
  assert.match(
    pr('🧹 Groom backlog', { ...groom, numstat: '150\t0\ta.ts\n' }).warnings.join(),
    /soft limit/,
  );
  assert.match(
    pr('🧹 Groom backlog', { ...groom, numstat: '1500\t0\ta.ts\n' }).errors.join(),
    /hard limit/,
  );
  assert.deepEqual(
    pr('🧹 Groom backlog', { ...groom, numstat: '5000\t0\tpackage-lock.json\n' }).warnings,
    [],
  );
});

test('PR size: effort-S tickets are exempt, judged by the base ticket', () => {
  const headCfg = config({
    grooming: { every: 7, last: '2026-10-17', completed_since: ['SPN-001'] },
  });
  const land = (effort: Effort) =>
    pr('🪞 SPN-001 Do the thing', {
      base: [ticket('SPN-001', { effort })],
      headCfg,
      numstat: '5000\t0\ta.ts\n',
    });
  assert.deepEqual(land('S').errors, []);
  assert.match(land('S').warnings.join(), /effort-S tickets have no size limit/);
  assert.match(land('M').errors.join(), /hard limit/);
  assert.match(land('L').errors.join(), /hard limit/);
  assert.match(land('XL').errors.join(), /hard limit/);
});

test('XL effort retains the PR soft-limit split warning', () => {
  const result = pr('🪞 SPN-001 Do the thing', {
    base: [ticket('SPN-001', { effort: 'XL' })],
    numstat: '150\t0\ta.ts\n',
  });
  assert.deepEqual(result.errors, []);
  assert.match(result.warnings.join(), /soft limit; consider splitting/);
});

test('a PR cannot loosen its own limits', () => {
  const headCfg = (over: Partial<BacklogConfig>) =>
    config({ grooming: { every: 7, last: '2026-10-17', completed_since: ['SPN-001'] }, ...over });
  const full = ['SPN-002', 'SPN-003', 'SPN-004', 'SPN-005', 'SPN-006', 'SPN-007', 'SPN-008'];
  const baseCfg = config({ grooming: { every: 7, last: '2026-10-17', completed_since: full } });
  const raised = config({
    grooming: { every: 8, last: '2026-10-17', completed_since: [...full, 'SPN-001'] },
  });
  assert.match(
    pr('🪞 SPN-001 Do the thing', { baseCfg, headCfg: raised }).errors.join(),
    /may change "grooming.every"/,
  );
  const bigger = headCfg({ size: { ...config().size, hard: 1e9 } });
  const big = pr('🪞 SPN-001 Do the thing', { headCfg: bigger, numstat: '5000\t0\ta.ts\n' });
  assert.match(big.errors.join(), /may change "size"/);
  assert.match(big.errors.join(), /hard limit/);
  const feat = config({ pr_title_exceptions: ['🧹 Groom backlog', '⬆️ Bump', 'feat'] });
  assert.match(
    pr('feat: anything', { head: [ticket('SPN-001')], headCfg: feat }).errors.join(),
    /must be "<emoji> SPN-NNN/,
  );
});

test('only grooming PRs remove tickets other than the one landing', () => {
  const base = [ticket('SPN-001'), ticket('SPN-002', { emoji: '🧭' })];
  assert.match(
    pr('🪞 SPN-001 Do the thing', { base }).errors.join(),
    /removes only its own ticket \(also removed SPN-002\)/,
  );
  const bump = pr('⬆️ Bump vite', {
    base,
    head: [ticket('SPN-002', { emoji: '🧭' })],
    headCfg: config(),
  });
  assert.match(bump.errors.join(), /only ticket PRs and grooming PRs remove tickets/);
  assert.deepEqual(pr('🧹 Groom backlog', { base, head: [], headCfg: config() }).errors, []);
});

test('grooming dates never go backwards or into the future', () => {
  const at = (last: string) => config({ grooming: { every: 7, last, completed_since: [] } });
  const groom = (last: string) =>
    pr('🧹 Groom backlog', { head: [ticket('SPN-001')], headCfg: at(last) }).errors.join();
  assert.equal(groom('2026-10-17'), '');
  assert.match(groom('2026-10-01'), /grooming.last is 2026-10-01/);
  assert.match(groom('2026-11-30'), /grooming.last is 2026-11-30/);
  assert.match(
    check([], config({ grooming: { every: 7, last: 'soon', completed_since: [] } })).errors.join(),
    /YYYY-MM-DD/,
  );
});

test('repeated frontmatter keys are an error', () => {
  assert.match(parseFrontmatter('---\nscore: 1\nscore: 2\n---\n').error ?? '', /repeats "score"/);
});
