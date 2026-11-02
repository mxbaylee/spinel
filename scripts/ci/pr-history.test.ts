import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  historyCheckpointMarker,
  historyValidationStep,
  readPolicyHistoryWindow,
  parseHistoryCheckpointMarker,
  verifyHistoryCheckpoint,
} from './pr-history.ts';

function fixture(full = false) {
  const after = Date.parse('2026-11-01T12:00:20Z');
  const checkpoint = { sequence: 20, full, after: full ? after : null, atOrAfter: null };
  const head = 'b'.repeat(40);
  const run = {
    id: 100,
    run_number: 20,
    run_attempt: 1,
    check_suite_id: 900,
    workflow_id: 42,
    repository: { full_name: 'owner/repo' },
    path: '.github/workflows/pr-policy.yml',
    event: 'pull_request',
    pull_requests: [{ number: 129 }],
    head_sha: head,
    display_title: `PR policy v2 pr=129 action=edited base=${'a'.repeat(40)} head=${head} tested=${'c'.repeat(40)}`,
    created_at: '2026-11-01T12:00:30Z',
    status: 'completed',
    conclusion: 'failure' as string | null,
  };
  const job = {
    id: 200,
    run_id: 100,
    run_attempt: 1,
    head_sha: head,
    name: 'Pull request',
    status: 'completed',
    conclusion: 'failure' as string | null,
    check_run_url: 'https://api.github.com/repos/owner/repo/check-runs/300',
    steps: [
      {
        number: 3,
        name: historyValidationStep,
        status: 'completed',
        conclusion: 'success',
        completed_at: '2026-11-01T12:00:40Z',
      },
      {
        number: 4,
        name: historyCheckpointMarker(checkpoint),
        status: 'completed',
        conclusion: 'success',
        completed_at: '2026-11-01T12:00:41Z',
      },
      {
        number: 5,
        name: 'Validate title and genuine code admission',
        status: 'completed',
        conclusion: 'failure' as string | null,
        completed_at: '2026-11-01T12:00:42Z',
      },
    ],
  };
  const check = {
    id: 300,
    name: 'Pull request',
    head_sha: head,
    check_suite: { id: 900 },
    app: { id: 15368 },
    status: 'completed',
    conclusion: 'failure' as string | null,
  };
  const expected = {
    repository: 'owner/repo',
    number: 129,
    workflowId: 42,
    createdAt: '2026-11-01T12:00:00Z',
    upperSequence: 21,
    currentRunId: 101,
    currentAttempt: 1,
  };
  return { checkpoint, run, job, check, expected };
}

const verify = (value: ReturnType<typeof fixture>) =>
  verifyHistoryCheckpoint(value.run, value.job, value.check, value.expected);

test('history proof remains independent of pending or failed code/title admission', () => {
  for (const full of [false, true]) {
    const f = fixture(full);
    assert.deepEqual(verify(f), f.checkpoint);
    f.job.status = f.check.status = f.run.status = 'in_progress';
    f.job.conclusion = f.check.conclusion = f.run.conclusion = null;
    assert.deepEqual(verify(f), f.checkpoint);
    // No current-source equality is required: this proves PR history only.
    f.run.display_title = f.run.display_title.replace(
      'base=' + 'a'.repeat(40),
      'base=' + 'd'.repeat(40),
    );
    assert.deepEqual(verify(f), f.checkpoint);
  }
});

test('history markers preserve both full-request bounds and reject incomplete or noncanonical certificates', () => {
  const checkpoint = { sequence: 20, full: true, after: 1793534420000, atOrAfter: 1793534421000 };
  assert.deepEqual(parseHistoryCheckpointMarker(historyCheckpointMarker(checkpoint)), checkpoint);
  assert.equal(parseHistoryCheckpointMarker('An unrelated successful step'), null);
  assert.equal(parseHistoryCheckpointMarker('PR history v3 seq=20'), null);
  for (const value of [
    { ...checkpoint, sequence: 0 },
    { ...checkpoint, sequence: Number.MAX_SAFE_INTEGER + 1 },
    { ...checkpoint, after: null },
    { ...checkpoint, full: false },
    { ...checkpoint, atOrAfter: Number.NaN },
  ])
    assert.throws(() => historyCheckpointMarker(value));
  for (const marker of [
    'PR history v2 seq=01 full=0 after=0 notify=0',
    'PR history v2 seq=1 full=1 after=0 notify=0',
    'PR history v2 seq=1 full=0 after=0 notify=1',
    'PR history v2 seq=1 full=0 after=0 notify=0\n',
    'PR history v2 seq=9007199254740992 full=0 after=0 notify=0',
  ])
    assert.throws(() => parseHistoryCheckpointMarker(marker));
});

test('history certificate binds the provider run, job, check, app, source and supported protocol', () => {
  const corruptions: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.run.repository.full_name = 'foreign/repo';
    },
    (f) => {
      f.run.workflow_id++;
    },
    (f) => {
      f.run.path = '.github/workflows/ci.yml';
    },
    (f) => {
      f.run.event = 'workflow_dispatch';
    },
    (f) => {
      f.run.pull_requests[0].number++;
    },
    (f) => {
      f.run.display_title = f.run.display_title.replace('v2', 'v1');
    },
    (f) => {
      f.run.head_sha = 'd'.repeat(40);
    },
    (f) => {
      f.job.run_id++;
    },
    (f) => {
      f.job.run_attempt++;
    },
    (f) => {
      f.job.head_sha = 'd'.repeat(40);
    },
    (f) => {
      f.check.app.id++;
    },
    (f) => {
      f.check.check_suite.id++;
    },
    (f) => {
      f.check.id++;
    },
    (f) => {
      f.check.head_sha = 'd'.repeat(40);
    },
    (f) => {
      f.job.name = 'Forged history';
    },
    (f) => {
      f.check.name = 'Forged history';
    },
    (f) => {
      f.expected.currentRunId = f.run.id;
    },
  ];
  for (const corrupt of corruptions) {
    const f = fixture();
    corrupt(f);
    assert.throws(() => verify(f), /invalid/);
  }
});

test('missing, unsuccessful, duplicated or out-of-order history proof cannot issue a checkpoint', () => {
  const absent = fixture();
  absent.job.steps.splice(1, 1);
  assert.equal(verify(absent), null);
  const corruptions: ((f: ReturnType<typeof fixture>) => void)[] = [
    (f) => {
      f.job.steps[0].conclusion = 'failure';
    },
    (f) => {
      f.job.steps[1].conclusion = 'skipped';
    },
    (f) => {
      f.job.steps[1].status = 'in_progress';
    },
    (f) => {
      f.job.steps.push({ ...f.job.steps[1] });
    },
    (f) => {
      f.job.steps.push({ ...f.job.steps[0] });
    },
    (f) => {
      f.job.steps[1].number = 2;
    },
    (f) => {
      f.job.steps[1].completed_at = '2026-11-01T12:00:39Z';
    },
    (f) => {
      f.job.steps[0].completed_at = '2026-11-01T12:00:29Z';
    },
    (f) => {
      f.run.created_at = '2026-11-01T11:59:59Z';
    },
  ];
  for (const corrupt of corruptions) {
    const f = fixture();
    corrupt(f);
    assert.throws(() => verify(f), /invalid/);
  }
});

test('checkpoint coverage cannot omit its issuer, reach unseen future runs, or invent request times', () => {
  for (const patch of [
    { sequence: 19 },
    { sequence: 22 },
    { after: Date.parse('2026-11-01T11:59:59Z') },
    { after: Date.parse('2026-11-01T12:00:41Z') },
    { atOrAfter: Date.parse('2026-11-01T12:00:41Z') },
  ]) {
    const f = fixture(true);
    f.job.steps[1].name = historyCheckpointMarker({ ...f.checkpoint, ...patch });
    assert.throws(() => verify(f), /invalid/);
  }
  const retry = fixture();
  retry.run.run_attempt = 2;
  retry.expected.currentRunId = retry.run.id;
  retry.expected.currentAttempt = 2;
  assert.deepEqual(verify(retry), retry.checkpoint);
  retry.run.run_attempt = retry.job.run_attempt = 3;
  assert.throws(() => verify(retry), /invalid/);
});

function windowRow(sequence: number, created_at = '2026-11-01T12:00:01Z') {
  return {
    id: 1000 + sequence,
    run_number: sequence,
    run_attempt: 1,
    workflow_id: 42,
    path: '.github/workflows/pr-policy.yml',
    repository: { full_name: 'owner/repo' },
    created_at,
  };
}
function windowReader(
  rows: ReturnType<typeof windowRow>[],
  options: {
    refresh?: ReturnType<typeof windowRow>[];
    current?: ReturnType<typeof windowRow>;
  } = {},
) {
  let firstReads = 0;
  const calls: string[] = [];
  return {
    calls,
    repository: 'owner/repo',
    async get(path: string) {
      calls.push(path);
      if (path.startsWith('actions/runs/'))
        return options.current ?? rows.find((run) => path.endsWith('/' + run.id));
      const match = /^actions\/workflows\/42\/runs\?per_page=100&page=([1-9][0-9]*)$/.exec(path);
      assert.ok(match, 'Registration queries must not filter away sequence entries.');
      const page = Number(match[1]);
      const source = page === 1 && ++firstReads > 1 && options.refresh ? options.refresh : rows;
      return {
        total_count: source.length,
        workflow_runs: source.slice((page - 1) * 100, page * 100),
      };
    },
  };
}

const windowOptions = () => ({
  workflowId: 42,
  createdAt: '2026-11-01T12:00:00Z',
  isOpening: async (_run: Record<string, unknown>) => false,
  checkpoint: async (
    _run: Record<string, unknown>,
    _upper: number,
  ): Promise<ReturnType<typeof fixture>['checkpoint'] | null> => null,
});

test('global history includes timestamp ties and ends only at a strict pre-PR predecessor', async () => {
  const reader = windowReader([
    windowRow(4),
    windowRow(3, '2026-11-01T12:00:00Z'),
    windowRow(2, '2026-11-01T11:59:59Z'),
    windowRow(1, '2026-11-01T11:59:58Z'),
  ]);
  const result = await readPolicyHistoryWindow(reader, {
    ...windowOptions(),
    currentRun: { id: 1004, sequence: 4 },
  });
  assert.equal(result.boundary, 'predecessor');
  assert.equal(result.throughSequence, 2);
  assert.deepEqual(
    result.runs.map((run) => run.run_number),
    [4, 3],
  );
  assert.equal(reader.calls.filter((path) => path.includes('page=1')).length, 2);
});

test('run one needs independent opening provenance and cannot stand in for late activation', async () => {
  await assert.rejects(
    readPolicyHistoryWindow(windowReader([windowRow(1)]), windowOptions()),
    /prefix is unavailable/,
  );
  const result = await readPolicyHistoryWindow(windowReader([windowRow(2), windowRow(1)]), {
    ...windowOptions(),
    isOpening: async (run) => run.run_number === 1,
  });
  assert.equal(result.boundary, 'opening');
  assert.equal(result.throughSequence, 0);
  assert.equal(result.runs.length, 2);
});

test('a verified covering checkpoint preserves an expired prefix but never fills a suffix gap', async () => {
  const checkpoint = {
    sequence: 20,
    full: true,
    after: Date.parse('2026-11-01T12:00:00Z'),
    atOrAfter: null,
  };
  const options = {
    ...windowOptions(),
    checkpoint: async (run: Record<string, unknown>) => (run.run_number === 18 ? checkpoint : null),
  };
  const result = await readPolicyHistoryWindow(
    windowReader([windowRow(22), windowRow(21), windowRow(18)]),
    options,
  );
  assert.equal(result.boundary, 'checkpoint');
  assert.deepEqual(
    result.runs.map((run) => run.run_number),
    [22, 21],
  );
  assert.deepEqual(result.checkpoint, checkpoint);
  await assert.rejects(
    readPolicyHistoryWindow(windowReader([windowRow(22), windowRow(18)]), options),
    /prefix is unavailable/,
  );
  await assert.rejects(
    readPolicyHistoryWindow(windowReader([windowRow(18)]), options),
    /invalid sequence/,
  );
});

test('an older later-finishing checkpoint may close a gap left by a newer issuer', async () => {
  const result = await readPolicyHistoryWindow(
    windowReader([windowRow(25), windowRow(24), windowRow(22), windowRow(18)]),
    {
      ...windowOptions(),
      checkpoint: async (run) => {
        if (run.run_number !== 22 && run.run_number !== 18) return null;
        return {
          sequence: run.run_number === 22 ? 22 : 24,
          full: false,
          after: null,
          atOrAfter: null,
        };
      },
    },
  );
  assert.equal(result.boundary, 'checkpoint');
  assert.equal(result.throughSequence, 24);
  assert.deepEqual(
    result.runs.map((run) => run.run_number),
    [25],
  );
});

test('a covering checkpoint cannot discard full bounds observed in a weaker anchor', async () => {
  const after = Date.parse('2026-11-01T12:00:20Z');
  const observed = { sequence: 22, full: true, after, atOrAfter: after + 1 };
  for (const covering of [
    { sequence: 24, full: false, after: null, atOrAfter: null },
    { sequence: 24, full: true, after: after - 1, atOrAfter: after + 1 },
    { sequence: 24, full: true, after, atOrAfter: null },
  ]) {
    await assert.rejects(
      readPolicyHistoryWindow(
        windowReader([windowRow(25), windowRow(24), windowRow(22), windowRow(18)]),
        {
          ...windowOptions(),
          checkpoint: async (run) =>
            run.run_number === 22 ? observed : run.run_number === 18 ? covering : null,
        },
      ),
      /weakens an observed full requirement/,
    );
  }
  const covering = { ...observed, sequence: 24, after: after + 2, atOrAfter: after + 3 };
  const result = await readPolicyHistoryWindow(
    windowReader([windowRow(25), windowRow(24), windowRow(22), windowRow(18)]),
    {
      ...windowOptions(),
      checkpoint: async (run) =>
        run.run_number === 22 ? observed : run.run_number === 18 ? covering : null,
    },
  );
  assert.deepEqual(result.checkpoint, covering);
});

test('missing, duplicate, foreign and shifted registration history cannot be certified', async () => {
  const before = '2026-11-01T11:59:59Z';
  for (const rows of [
    [windowRow(4), windowRow(2, before)],
    [windowRow(3), windowRow(3), windowRow(2, before)],
    [windowRow(3), { ...windowRow(2, before), workflow_id: 99 }],
    [windowRow(2), windowRow(3, before)],
    [windowRow(3, '2026-11-01T12:00:00Z'), windowRow(2), windowRow(1, before)],
  ])
    await assert.rejects(readPolicyHistoryWindow(windowReader(rows), windowOptions()));
  await assert.rejects(
    readPolicyHistoryWindow(
      windowReader([windowRow(2), windowRow(1, before)], {
        refresh: [windowRow(3), windowRow(2), windowRow(1, before)],
      }),
      windowOptions(),
    ),
    /changed during pagination/,
  );
});

test('the current invocation must be registered and covered even when an older checkpoint is available', async () => {
  const rows = [windowRow(3), windowRow(2, '2026-11-01T11:59:59Z')];
  await assert.rejects(
    readPolicyHistoryWindow(windowReader(rows, { current: windowRow(4) }), {
      ...windowOptions(),
      currentRun: { id: 1004, sequence: 4 },
    }),
    /current policy invocation is not included/,
  );
  await assert.rejects(
    readPolicyHistoryWindow(windowReader(rows, { current: windowRow(5) }), {
      ...windowOptions(),
      currentRun: { id: 1004, sequence: 4 },
    }),
    /no verified registration/,
  );
});

test('history scans additional pages only to the needed boundary and caps missing-prefix reads', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => windowRow(201 - index));
  rows[100].created_at = '2026-11-01T11:59:59Z';
  const reader = windowReader(rows);
  const result = await readPolicyHistoryWindow(reader, windowOptions());
  assert.equal(result.runs.length, 100);
  assert.ok(reader.calls.some((path) => path.endsWith('page=2')));
  const tooLong = windowReader(Array.from({ length: 1001 }, (_, index) => windowRow(2001 - index)));
  await assert.rejects(readPolicyHistoryWindow(tooLong, windowOptions()), /bounded read/);
  assert.equal(tooLong.calls.length, 10);
});
