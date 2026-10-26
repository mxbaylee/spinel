import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
if (args.some((arg) => arg === '--project' || arg.startsWith('--project='))) {
  console.error(
    'This command verifies both builds. For one build, use SPINEL_E2E_PROJECT with Playwright directly; see docs/collaboration.md.',
  );
  process.exit(1);
}

// App processes each retain SDK runtimes. Verify both builds and mobile HTTPS, giving each
// the same single-server environment as the deployed app and preserve failures
// from either project. Browser contexts still exercise concurrent real editors.
for (const project of [
  'development',
  'production',
  'mobile-https',
  'sync-development',
  'sync-production',
]) {
  const result = spawnSync(
    process.execPath,
    [resolve('node_modules/@playwright/test/cli.js'), 'test', `--project=${project}`, ...args],
    { stdio: 'inherit', env: { ...process.env, SPINEL_E2E_PROJECT: project } },
  );
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exitCode = 1;
}
