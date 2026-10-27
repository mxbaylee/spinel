import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { faviconSvg } from '../../src/ui/favicon.ts';
import { stampStorybook, validateRedesignStories } from './storybook-identity.ts';

test('a published build identifies its source and replaces both competing favicons', () => {
  const directory = mkdtempSync(join(tmpdir(), 'storybook-identity-'));
  try {
    for (const name of ['index.html', 'iframe.html']) {
      writeFileSync(
        join(directory, name),
        '<head><link rel="stylesheet" href="style.css"><link rel="icon" href="old.svg"><link\nrel="icon" href="data:image/svg+xml,old"></head><body>Story</body>',
      );
    }
    const identity = {
      sha: 'a'.repeat(40),
      checkedOutSha: 'b'.repeat(40),
      branch: 'codex/example',
      pullRequest: 150,
      workflowUrl: 'https://github.com/example/project/actions/runs/1',
      builtAt: '2026-10-23T00:00:00.000Z',
    };
    stampStorybook(directory, identity);
    assert.deepEqual(JSON.parse(readFileSync(join(directory, 'sha.json'), 'utf8')), identity);
    assert.equal(readFileSync(join(directory, 'favicon.svg'), 'utf8'), faviconSvg());
    for (const name of ['index.html', 'iframe.html']) {
      const html = readFileSync(join(directory, name), 'utf8');
      assert.equal(html.match(/rel="icon"/g)?.length, 1);
      assert.ok(html.includes(`favicon.svg?v=${identity.sha}`));
      assert.ok(html.includes('rel="stylesheet"'));
      assert.ok(html.includes('<body>Story</body>'));
    }
    assert.throws(() => stampStorybook(directory, { ...identity, sha: 'not a commit' }), /SHAs/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Redesign examples require an open ticket and disappear when its ticket lands', () => {
  const pending = { preview: { type: 'story', title: 'Redesign/SPN-066 Guest links' } };
  assert.doesNotThrow(() => validateRedesignStories(pending, ['SPN-066']));
  assert.throws(() => validateRedesignStories(pending, []), /open owning ticket/);
  assert.throws(
    () =>
      validateRedesignStories({ old: { type: 'story', title: 'Redesign/Walkthrough' } }, [
        'SPN-066',
      ]),
    /open owning ticket/,
  );
  // The final migration may leave no Redesign examples at all.
  assert.doesNotThrow(() =>
    validateRedesignStories(
      { frame: { type: 'story', title: 'Current production/Editor/Frame' } },
      [],
    ),
  );
});
