import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import {
  failureDiagnosis,
  offlineDiagnosisReserveMilliseconds,
  offlinePreparationMilliseconds,
  offlineResultScript,
  offlineStateScript,
  prepareDashboardItemOffline,
  prepareSpacePageOffline,
  type OfflinePreparationDriver,
} from './browserstack-offline-preparation.ts';

const item = { kind: 'sheet', name: 'Desktop normal sheet' };
const page = { kind: 'doc', name: 'Phone prepared page' };
const message = (name: string) => `${name} is available offline on this device.`;
const nothing = { menu: [], dialog: [] };
const updating = { menu: [{ text: 'Updating offline copy…', disabled: true }], dialog: [] };

function harness(
  name: string,
  results: unknown[],
  options: { states?: unknown[]; reopenFails?: boolean; diagnose?: boolean; left?: number } = {},
) {
  const calls: string[] = [];
  const records: [string, unknown][] = [];
  const states = [...(options.states ?? [nothing])];
  let resultReads = 0;
  const driver: OfflinePreparationDriver = {
    click: async (selector, label) => {
      calls.push(`click ${selector} ${label}`);
      if (options.reopenFails && resultReads > 0) throw new Error('menu-gone');
    },
    execute: async (script, args) => {
      if (script === offlineStateScript) {
        calls.push('labels');
        return states.length > 1 ? states.shift() : states[0];
      }
      assert.equal(script, offlineResultScript);
      assert.deepEqual(args, [message(name)]);
      calls.push('read');
      resultReads++;
      return results.length > 1 ? results.shift() : results[0];
    },
    poll: async (read, accepts, label, maximum) => {
      calls.push(`poll ${label} ${maximum}`);
      for (let attempt = 0; attempt < 3; attempt++) {
        const value = await read();
        if (accepts(value)) return value;
      }
      throw new Error(`test-${label}`);
    },
    record: async (stage, value) => void records.push([stage, value]),
    failure: (code) => new Error(`test-${code}`),
    ...(options.left === undefined ? {} : { left: () => options.left! }),
    ...(options.diagnose
      ? {
          diagnose: async <T>(work: () => Promise<T>) => {
            calls.push('diagnose');
            try {
              return await work();
            } finally {
              calls.push('diagnosed');
            }
          },
        }
      : {}),
  };
  return { calls, records, driver };
}
const pending = { dialogs: 0, done: false, alert: null };
const open = { dialogs: 1, done: false, alert: null };

test('Dashboard preparation waits for the app result and closes its dialog once', async () => {
  const run = harness(item.name, [pending, { dialogs: 1, done: true, alert: null }]);
  await prepareDashboardItemOffline(run.driver, item);
  assert.deepEqual(run.calls, [
    'click button Document actions',
    'click [role="menuitem"] Available offline on this device',
    `poll download-incomplete ${offlinePreparationMilliseconds}`,
    'read',
    'read',
    'click [role="dialog"] button Done',
  ]);
  assert.equal(offlinePreparationMilliseconds, 60_000);
  assert.deepEqual(run.records, []);
});

test('an app alert fails as download-failed with its text and no dismissal', async () => {
  const refused = { dialogs: 1, done: false, alert: 'Could not change offline availability.' };
  const run = harness(item.name, [refused]);
  await assert.rejects(
    prepareDashboardItemOffline(run.driver, item),
    /^Error: test-download-failed$/,
  );
  assert.deepEqual(run.records, [['sheet:download-state', { last: refused }]]);
  assert.ok(!run.calls.some((call) => call.endsWith(' Done')));
});

test('a Dashboard timeout reads labels first, reopens a closed menu once and keeps the original failure', async () => {
  const run = harness(item.name, [pending], { states: [nothing, updating], diagnose: true });
  await assert.rejects(
    prepareDashboardItemOffline(run.driver, item),
    /^Error: test-download-incomplete$/,
  );
  // Every evidence read runs inside the runner's diagnose hook.
  assert.deepEqual(run.calls.slice(-5), [
    'diagnose',
    'labels',
    'click button Document actions',
    'labels',
    'diagnosed',
  ]);
  assert.equal(run.calls.filter((call) => call.includes('Available offline')).length, 1);
  assert.deepEqual(run.records, [
    ['sheet:download-state', { last: pending, labels: { reopened: true, ...updating } }],
  ]);

  // A menu still open (the click never registered) is read as it is, not toggled shut.
  const stillOpen = {
    menu: [{ text: 'Available offline on this device', disabled: false }],
    dialog: [],
  };
  const open = harness(item.name, [pending], { states: [stillOpen] });
  await assert.rejects(prepareDashboardItemOffline(open.driver, item), /download-incomplete/);
  assert.equal(open.calls.at(-1), 'labels');
  assert.equal(open.calls.filter((call) => call === 'click button Document actions').length, 1);
  assert.deepEqual(open.records, [['sheet:download-state', { last: pending, labels: stillOpen }]]);

  const lost = harness(item.name, [pending], { reopenFails: true });
  await assert.rejects(
    prepareDashboardItemOffline(lost.driver, item),
    /^Error: test-download-incomplete$/,
  );
  assert.deepEqual(lost.records, [['sheet:download-state', { last: pending, labels: nothing }]]);
});

test('a Space page prepares through the Offline copies dialog and reads it in place on timeout', async () => {
  const run = harness(page.name, [open, { dialogs: 1, done: true, alert: null }]);
  await prepareSpacePageOffline(run.driver, page);
  assert.deepEqual(run.calls, [
    'click button Document actions',
    'click [role="menuitem"] Offline copies',
    'click [role="dialog"] button Make Phone prepared page available offline on this device',
    `poll download-incomplete ${offlinePreparationMilliseconds}`,
    'read',
    'read',
    'click [role="dialog"] button Close dialog',
  ]);

  const downloading = { menu: [], dialog: [{ text: 'Downloading…', disabled: true }] };
  const stalled = harness(page.name, [open], { states: [downloading] });
  await assert.rejects(
    prepareSpacePageOffline(stalled.driver, page),
    /^Error: test-download-incomplete$/,
  );
  // The dialog is still open, so its own buttons are read without another click.
  assert.equal(stalled.calls.at(-1), 'labels');
  assert.equal(stalled.calls.filter((call) => call.startsWith('click')).length, 3);
  assert.deepEqual(stalled.records, [['doc:download-state', { last: open, labels: downloading }]]);

  // Each label is the one the app renders, so a renamed control fails here first.
  const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  assert.match(source('web/EditorTools.tsx'), /label="Document actions"/);
  assert.match(source('web/Dashboard.tsx'), /: 'Available offline on this device',/);
  assert.match(source('web/offline/OfflineAvailability.tsx'), />\s*Done\s*</);
  assert.match(
    source('web/Space.tsx'),
    /label: 'Offline copies', onClick: \(\) => setOfflineOpen\(true\)/,
  );
  assert.match(
    source('web/SpaceOfflineActions.tsx'),
    /`Make \$\{current\.name\} available offline on this device`/,
  );
  assert.match(source('src/ui/redesign/Controls.tsx'), /aria-label="Close dialog"/);
  assert.match(
    source('web/offline/useOfflineDownloads.ts'),
    /`\$\{item\.name\} is available offline on this device\.`/,
  );
});

test('the page scripts read only dialog roles and bounded visible labels', () => {
  const element = (text: string, attributes: Record<string, string> = {}) => ({
    textContent: ` ${text} `,
    getAttribute: (name: string) => attributes[name] ?? null,
  });
  const dialog = (status: string[], alert: string[]) => ({
    querySelectorAll: (selector: string) =>
      (selector === '[role="status"]' ? status : selector === '[role="alert"]' ? alert : []).map(
        (text) => element(text),
      ),
  });
  const documentWith = (dialogs: unknown[], menu: unknown[] = [], buttons: unknown[] = []) => ({
    querySelectorAll: (selector: string) =>
      ({
        '[role="dialog"]': dialogs,
        '[role="menuitem"]': menu,
        '[role="dialog"] button': buttons,
      })[selector] ?? [],
  });
  // Copy out of the page realm so deepEqual compares values, not prototypes.
  const read = (script: string, documentValue: unknown, args: unknown[] = []) =>
    JSON.parse(
      JSON.stringify(
        runInContext(
          `(function(){${script}}).apply(null,args)`,
          createContext({ document: documentValue, args }),
        ),
      ),
    );
  const text = message('Trip');
  assert.deepEqual(read(offlineResultScript, documentWith([]), [text]), pending);
  assert.deepEqual(read(offlineResultScript, documentWith([dialog([text], [])]), [text]), {
    dialogs: 1,
    done: true,
    alert: null,
  });
  // Another item's success is not this item's.
  assert.equal(
    read(offlineResultScript, documentWith([dialog([message('Other')], [])]), [text]).done,
    false,
  );
  assert.deepEqual(
    read(offlineResultScript, documentWith([dialog([], ['x'.repeat(300)])]), [text]),
    {
      dialogs: 1,
      done: false,
      alert: 'x'.repeat(200),
    },
  );
  assert.deepEqual(
    read(
      offlineStateScript,
      documentWith(
        [],
        [element('Updating offline copy…', { 'aria-disabled': 'true' }), element('y'.repeat(100))],
        [element('Downloading…', { 'aria-label': 'Make Trip available offline on this device' })],
      ),
    ),
    {
      menu: [
        { text: 'Updating offline copy…', disabled: true },
        { text: 'y'.repeat(80), disabled: false },
      ],
      dialog: [{ text: 'Downloading…', disabled: false }],
    },
  );
});

test('the wait leaves the phase room to record its diagnosis', async () => {
  const done = { dialogs: 1, done: true, alert: null };
  const waits = async (left: number) => {
    const run = harness(item.name, [done], { left });
    await prepareDashboardItemOffline(run.driver, item);
    return run.calls.find((call) => call.startsWith('poll'));
  };
  assert.equal(offlineDiagnosisReserveMilliseconds, 20_000);
  assert.equal(await waits(200_000), `poll download-incomplete ${offlinePreparationMilliseconds}`);
  assert.equal(await waits(50_000), 'poll download-incomplete 30000');
  // Too little left still waits one second, longer than a read takes.
  assert.equal(await waits(5_000), 'poll download-incomplete 1000');
});

test('failed evidence persistence cannot replace the original preparation failure', async () => {
  for (const [state, primaryMessage] of [
    [pending, 'test-download-incomplete'],
    [{ dialogs: 1, done: false, alert: 'Download failed' }, 'test-download-failed'],
  ] as const) {
    const run = harness(item.name, [state], { states: [updating] });
    const journalFailure = new Error('journal-unavailable');
    run.driver.record = async (stage, value) => {
      run.records.push([stage, value]);
      throw journalFailure;
    };
    await assert.rejects(prepareDashboardItemOffline(run.driver, item), (error) => {
      assert.ok(error instanceof AggregateError);
      assert.equal(error.message, primaryMessage);
      assert.equal(error.errors[0].message, primaryMessage);
      assert.equal(error.cause, error.errors[0]);
      assert.equal(error.errors[1], journalFailure);
      return true;
    });
    assert.equal(run.records.length, 1);
    assert.equal(
      run.calls.filter(
        (call) => call === 'click [role="menuitem"] Available offline on this device',
      ).length,
      1,
    );
    assert.ok(!run.calls.some((call) => call.endsWith(' Done')));
  }
});

test('the runner diagnosis screenshots first and keeps the failed command', async () => {
  const result = { command: 'POST session/{sessionId}/execute/sync (download-incomplete)' };
  const steps: string[] = [];
  const diagnose = failureDiagnosis(result, async () => {
    steps.push('screenshot');
    result.command = 'GET session/{sessionId}/screenshot';
  });
  const value = await diagnose(async () => {
    steps.push('labels');
    result.command = 'POST session/{sessionId}/element/click';
    return 'read';
  });
  assert.equal(value, 'read');
  assert.deepEqual(steps, ['screenshot', 'labels']);
  assert.equal(result.command, 'POST session/{sessionId}/execute/sync (download-incomplete)');
  await assert.rejects(
    diagnose(async () => {
      result.command = 'later';
      throw new Error('labels-gone');
    }),
    /labels-gone/,
  );
  assert.equal(result.command, 'POST session/{sessionId}/execute/sync (download-incomplete)');
});
