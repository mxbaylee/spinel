import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needsRestoreTiming } from './plan.ts';

test('sized restore follows authority, data, runtime, browser and harness boundaries', () => {
  for (const path of [
    'src/server/backup/restore-registry.ts',
    'src/server/maintenance/restore-job-intent.ts',
    'src/server/auth/store.ts',
    'src/server/workspace/documents.ts',
    'src/shared/restore.ts',
    'server/database.ts',
    'lib/sync-server/src/storage.ts',
    'web/BackupRestore.tsx',
    'web/Modal.tsx',
    'web/App.tsx',
    'web/profile.css',
    'web/admin.css',
    'web/auth.ts',
    'web/maintenanceFetch.ts',
    'web/api.ts',
    'src/ui/redesign/Controls.tsx',
    'e2e/restore-sized-fixture.ts',
    'e2e/restore-browser.acceptance.ts',
    'e2e/restore-headroom.ts',
    'e2e/doc-touch.ts',
    'scripts/deploy/maintenance.ts',
    'scripts/ci/changes.ts',
    'scripts/ci/restore-timing-changes.ts',
    'scripts/ci/restore-observer.test.ts',
    'scripts/ci/restore-headroom.test.ts',
    'scripts/dependencies/patch-univer-core.ts',
    'package-lock.json',
    '.dockerignore',
    'Dockerfile',
    'vite.config.ts',
    '.github/workflows/ci.yml',
  ])
    assert.equal(needsRestoreTiming(['docs/maintenance.md', path]), true, path);
  assert.equal(needsRestoreTiming([]), true, 'An empty/uncertain range cannot skip acceptance.');
});

test('unrelated text and browser work keep the ordinary gates without the sized restore', () => {
  for (const paths of [
    ['docs/maintenance.md', 'docs/todo/backlog.json'],
    ['README.md', 'AGENTS.md'],
    ['e2e/profile-navigation.spec.ts'],
    ['scripts/backlog/check.ts'],
  ])
    assert.equal(needsRestoreTiming(paths), false, paths.join(', '));
});
