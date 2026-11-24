import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { firefoxStoragePromptScript } from './desktop-browser.ts';

const question = 'Allow localhost:8176 to store data in persistent storage?';
const owner = { unixId: 2593, name: 'Firefox', bundleIdentifier: 'org.mozilla.firefox' };
const helper = {
  unixId: 2622,
  name: 'plugin-container',
  bundleIdentifier: 'org.mozilla.plugincontainer',
};

function fixture(
  options: {
    records?: (typeof owner)[];
    identity?: (read: number) => typeof owner;
    text?: string;
    disabled?: boolean;
    webOnly?: boolean;
  } = {},
) {
  const calls: string[] = [];
  let identityReads = 0;
  const element = (role: string, name: string, children: unknown[] = [], enabled = true) => ({
    properties: () => ({ role, name, enabled, size: [100, 30] }),
    uiElements: () => children,
  });
  const allow = element('AXButton', 'Allow', [], !options.disabled);
  const prompt = element('AXPopover', '', [
    element('AXStaticText', options.text ?? question),
    allow,
    element('AXButton', 'Block'),
  ]);
  const process = {
    properties: () => options.identity?.(++identityReads) ?? owner,
    attributes: {
      byName: (name: string) => {
        assert.equal(name, 'AXRole');
        return { value: () => 'AXApplication' };
      },
    },
    set frontmost(value: boolean) {
      assert.equal(value, true);
      calls.push('foreground');
    },
    windows: () => [
      element('AXWindow', '', [
        element('AXToolbar', ''),
        options.webOnly ? element('AXWebArea', '', [prompt]) : prompt,
      ]),
    ],
  };
  const system = {
    applicationProcesses: {
      // Model the observed failure: evaluating the old filtered collection can
      // return a helper reference, while the scalar inventory keeps the owner.
      whose: (query: { unixId?: number; name?: string }) =>
        Object.defineProperties(
          () => [
            {
              unixId: () => helper.unixId,
              name: () => helper.name,
              bundleIdentifier: () => helper.bundleIdentifier,
            },
          ],
          {
            name: {
              value: () =>
                (options.records ?? [helper, owner])
                  .filter((record) => record.unixId === query.unixId)
                  .map((record) => record.name),
            },
            unixId: {
              value: () =>
                (options.records ?? [helper, owner])
                  .filter((record) => record.name === query.name)
                  .map((record) => record.unixId),
            },
          },
        ),
      byName: (name: string) => {
        assert.equal(name, owner.name);
        calls.push('resolve-name');
        return process;
      },
    },
    click: (target: unknown) => {
      assert.equal(target, allow);
      calls.push('allow');
    },
  };
  return {
    calls,
    run(action = 'inspect', expected = '', pid = String(owner.unixId)) {
      const result = runInNewContext(`${firefoxStoragePromptScript}\nrun(argv)`, {
        Application: (name: string) => {
          assert.equal(name, 'System Events');
          return system;
        },
        argv: [pid, action, expected],
        console: { log: () => {} },
      });
      return JSON.parse(result);
    },
  };
}

test('permission inspection selects the owned Firefox despite helper collection references', () => {
  const f = fixture();
  const result = f.run();
  assert.equal(result.status, 'recognized');
  assert.equal(result.process.pid, owner.unixId);
  assert.equal(result.action, 'none');
  assert.deepEqual(f.calls, ['resolve-name', 'foreground']);
  assert.equal(f.run('allow', question).action, 'allow');
  assert.equal(f.calls.filter((call) => call === 'allow').length, 1);
});

test('missing, ambiguous, wrong-bundle and invalid PID identities never touch chrome', () => {
  for (const records of [[], [helper], [owner, owner], [owner, { ...owner, unixId: 9999 }]]) {
    const f = fixture({ records });
    assert.throws(() => f.run(), /unavailable or ambiguous|process changed/);
    assert.deepEqual(f.calls, []);
  }
  const wrongBundle = fixture({
    identity: () => ({ ...owner, bundleIdentifier: helper.bundleIdentifier }),
  });
  assert.throws(() => wrongBundle.run(), /process changed/);
  assert.equal(wrongBundle.calls.includes('foreground'), false);
  for (const pid of ['NaN', '0', '-1', '1.5']) {
    const f = fixture();
    assert.throws(() => f.run('inspect', '', pid), /Invalid owned/);
    assert.deepEqual(f.calls, []);
  }
});

test('changed name-specifier identity is rejected before foreground and immediately before Allow', () => {
  for (const boundary of [1, 2, 3]) {
    const f = fixture({ identity: (read) => (read >= boundary ? helper : owner) });
    assert.throws(() => f.run('allow', question), /process changed/);
    assert.equal(f.calls.includes('allow'), false);
    assert.equal(f.calls.includes('foreground'), boundary === 3);
  }
});

test('only an unchanged enabled localhost native prompt can be approved', () => {
  for (const options of [
    { text: 'Allow example.com to store data in persistent storage?' },
    { disabled: true },
    { webOnly: true },
  ]) {
    const f = fixture(options);
    assert.throws(() => f.run('allow', question), /prompt changed/);
    assert.equal(f.calls.includes('allow'), false);
  }
  const f = fixture();
  assert.throws(() => f.run('allow', 'An earlier question'), /prompt changed/);
  assert.equal(f.calls.includes('allow'), false);
});
